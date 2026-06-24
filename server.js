const express = require('express');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@as-integrations/express5');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');   // <-- ADDED
const helmet = require('helmet');   // <-- ADDED
const cors = require('cors');        // <-- ADDED
const { login, getUserFromToken, requireRole } = require('./auth');

// CHANGED (Step 1 - fixes API2 Broken Authentication):
// Added a "login" mutation to the schema.
//
// ADDED (Step 8 - fixes API9 Improper Inventory Management):
// GraphQL schemas support built-in documentation via triple-quoted
// description strings on types, fields, and arguments. These are
// returned automatically by introspection and shown in tools like
// Postman's schema explorer and Apollo Sandbox -- this is the
// GraphQL-native equivalent of the REST version's README.md, except
// it lives directly inside the API contract itself.
const typeDefs = `
  """
  A single flight booking record.
  passengerName is personally identifiable information (PII) and must
  only be returned to the booking's owner or an admin.
  """
  type Booking {
    id: ID!
    "ID of the user who owns this booking. Used for access control -- never settable directly by a client."
    userId: ID!
    "Personally identifiable information (PII). Access-controlled: only the owner or an admin may view this."
    passengerName: String!
    flightNumber: String!
    origin: String!
    destination: String!
    date: String!
    "One of: Economy, Premium Economy, Business, First."
    seatClass: String!
    "One of: confirmed, cancelled. Only changeable via cancelBooking -- never directly settable on updateBooking."
    status: String!
  }

  """
  A paginated page of bookings. GraphQL has no built-in pagination
  format, so this custom type carries both the results and pagination
  metadata, mirroring the REST version's paginated JSON responses.
  """
  type BookingPage {
    page: Int!
    limit: Int!
    totalResults: Int!
    totalPages: Int!
    data: [Booking!]!
  }

  type Query {
    "Returns the logged-in user's own bookings, paginated. Requires authentication."
    bookings(page: Int, limit: Int): BookingPage!
    "Returns one booking by id. Requires authentication and ownership of the booking."
    booking(id: ID!): Booking
    "Admin only. Returns every booking in the system, regardless of owner, paginated."
    bookingsAll(page: Int, limit: Int): BookingPage!
  }

  type Mutation {
    "Authenticates a user and returns a JWT. Send the returned token as 'Authorization: Bearer <token>' on all other requests."
    login(username: String!, password: String!): String!
    "Creates a new booking owned by the logged-in user. Subject to per-flight and per-user seat limits."
    createBooking(passengerName: String!, flightNumber: String!, origin: String!, destination: String!, date: String!, seatClass: String!): Booking!
    "Updates editable fields of the caller's own booking. Does NOT accept a status argument -- use cancelBooking instead."
    updateBooking(id: ID!, passengerName: String, flightNumber: String, origin: String, destination: String, date: String, seatClass: String): Booking
    "Safely cancels the caller's own booking (sets status to 'cancelled')."
    cancelBooking(id: ID!): Booking
    "Admin only. Permanently deletes a booking record."
    deleteBooking(id: ID!): Boolean!
  }
`;

let bookings = [
  {
    id: "1",
    userId: 1,
    passengerName: "Evin Karakas",
    flightNumber: "TK1234",
    origin: "Istanbul",
    destination: "London",
    date: "2026-07-11",
    seatClass: "Economy",
    status: "confirmed"
  }
];
let nextId = 2;

// ADDED (Step 4c - fixes API4 + general input safety): same validation
// approach as the REST version. Rejects missing fields, oversized
// strings, and invalid seatClass values before any data is stored.
const ALLOWED_SEAT_CLASSES = ["Economy", "Premium Economy", "Business", "First"];

function validateBookingInput(args) {
  const { passengerName, flightNumber, origin, destination, date, seatClass } = args;

  if (!passengerName || !flightNumber || !origin || !destination || !date || !seatClass) {
    throw new Error("All fields are required: passengerName, flightNumber, origin, destination, date, seatClass");
  }
  if (passengerName.length > 100) {
    throw new Error("passengerName must be under 100 characters");
  }
  if (flightNumber.length > 10) {
    throw new Error("flightNumber must be under 10 characters");
  }
  if (origin.length > 50 || destination.length > 50) {
    throw new Error("origin and destination must be under 50 characters");
  }
  if (!ALLOWED_SEAT_CLASSES.includes(seatClass)) {
    throw new Error(`seatClass must be one of: ${ALLOWED_SEAT_CLASSES.join(", ")}`);
  }
}

// ADDED (Step 6 - fixes API6 Unrestricted Access to Sensitive Business
// Flows): same business-logic limits as the REST version. Worth noting:
// GraphQL allows multiple aliased mutations in ONE request (e.g.
// "a: createBooking(...) b: createBooking(...) c: createBooking(...)"),
// which makes seat-blocking abuse easier to attempt here than in REST --
// these checks matter even more for this version of the API.
const MAX_SEATS_PER_FLIGHT = 5;
const MAX_BOOKINGS_PER_USER_PER_FLIGHT = 2;

function getFlightBookingCounts(flightNumber, date, userId) {
  const activeBookingsForFlight = bookings.filter(b =>
    b.flightNumber === flightNumber &&
    b.date === date &&
    b.status !== "cancelled"
  );
  const userBookingsForFlight = activeBookingsForFlight.filter(b => b.userId === userId);
  return {
    totalForFlight: activeBookingsForFlight.length,
    totalForUser: userBookingsForFlight.length
  };
}

const resolvers = {
  Query: {
    // CHANGED (Step 2 - fixes API1 BOLA): now requires login (context.user),
    // and only returns bookings belonging to the logged-in user.
    // context is the 3rd resolver argument -- this is the GraphQL
    // equivalent of checking req.user in an Express route handler.
    // CHANGED (Step 4b - fixes API4): added pagination, same defaults
    // and hard cap as the REST version -- defaults to page 1, 10 per
    // page, capped at 50 even if a client requests more.
    bookings: (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      const myBookings = bookings.filter(b => b.userId === context.user.id);

      let page = args.page || 1;
      let limit = args.limit || 10;
      if (page < 1) page = 1;
      if (limit < 1) limit = 10;
      if (limit > 50) limit = 50;

      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedResults = myBookings.slice(startIndex, endIndex);

      return {
        page,
        limit,
        totalResults: myBookings.length,
        totalPages: Math.ceil(myBookings.length / limit),
        data: paginatedResults
      };
    },

    // ADDED (Step 5 - fixes API5): admin-only query, returns every
    // booking in the system regardless of owner. requireRole() throws
    // if context.user is missing OR doesn't have the 'admin' role --
    // this is the GraphQL equivalent of Express's
    // app.get(..., verifyToken, requireRole('admin'), handler).
    bookingsAll: (parent, args, context) => {
      requireRole(context.user, 'admin');

      let page = args.page || 1;
      let limit = args.limit || 10;
      if (page < 1) page = 1;
      if (limit < 1) limit = 10;
      if (limit > 50) limit = 50;

      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedResults = bookings.slice(startIndex, endIndex);

      return {
        page,
        limit,
        totalResults: bookings.length,
        totalPages: Math.ceil(bookings.length / limit),
        data: paginatedResults
      };
    },

    // CHANGED (Step 2 - fixes API1 BOLA): requires login, and checks
    // that the booking found actually belongs to the caller.
    booking: (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      const booking = bookings.find(b => b.id === args.id);
      if (!booking) return null;
      if (booking.userId !== context.user.id) {
        throw new Error('Forbidden: this booking does not belong to you');
      }
      return booking;
    }
  },
  Mutation: {
    // ADDED (Step 1 - fixes API2): login mutation. Same logic as the
    // REST /login route, just exposed as a GraphQL mutation instead of
    // an HTTP route. Returns a JWT string the client must send back as
    // "Authorization: Bearer <token>" on every subsequent request.
    login: (parent, args) => {
      return login(args.username, args.password);
    },

    // CHANGED (Step 2 - fixes API1 BOLA): requires login. userId now comes
    // from context.user.id (the verified token) -- NOT from any client
    // input. If we let the client specify userId directly, they could
    // create a booking and claim it belongs to someone else.
    createBooking: (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      // ADDED (Step 4c): validate input before creating anything
      validateBookingInput(args);

      // ADDED (Step 6 - fixes API6): business logic checks BEFORE
      // creating the booking.
      const counts = getFlightBookingCounts(args.flightNumber, args.date, context.user.id);

      if (counts.totalForFlight >= MAX_SEATS_PER_FLIGHT) {
        throw new Error("This flight is fully booked");
      }
      if (counts.totalForUser >= MAX_BOOKINGS_PER_USER_PER_FLIGHT) {
        throw new Error(`You already have the maximum of ${MAX_BOOKINGS_PER_USER_PER_FLIGHT} bookings on this flight`);
      }

      const newBooking = {
        id: String(nextId++),
        userId: context.user.id,
        passengerName: args.passengerName,
        flightNumber: args.flightNumber,
        origin: args.origin,
        destination: args.destination,
        date: args.date,
        seatClass: args.seatClass,
        status: "confirmed"
      };
      bookings.push(newBooking);
      return newBooking;
    },
    // CHANGED (Step 2 - fixes API1 BOLA): requires login and ownership.
    // NOTE: the "status" mass-assignment issue (API3) is still here on
    // purpose -- we fix that in Step 3, one issue at a time.
    // CHANGED (Step 3 - fixes API3 Mass Assignment): "status" is no longer
    // an argument on this mutation at all (removed from the schema above),
    // so a client cannot even attempt to set it here anymore.
    updateBooking: (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      const booking = bookings.find(b => b.id === args.id);
      if (!booking) return null;
      if (booking.userId !== context.user.id) {
        throw new Error('Forbidden: this booking does not belong to you');
      }
      // ADDED (Step 4c): validate only the fields actually being changed
      if (args.passengerName !== undefined && args.passengerName.length > 100) {
        throw new Error("passengerName must be under 100 characters");
      }
      if (args.flightNumber !== undefined && args.flightNumber.length > 10) {
        throw new Error("flightNumber must be under 10 characters");
      }
      if (args.origin !== undefined && args.origin.length > 50) {
        throw new Error("origin must be under 50 characters");
      }
      if (args.destination !== undefined && args.destination.length > 50) {
        throw new Error("destination must be under 50 characters");
      }
      if (args.seatClass !== undefined && !ALLOWED_SEAT_CLASSES.includes(args.seatClass)) {
        throw new Error(`seatClass must be one of: ${ALLOWED_SEAT_CLASSES.join(", ")}`);
      }
      if (args.passengerName !== undefined) booking.passengerName = args.passengerName;
      if (args.flightNumber !== undefined) booking.flightNumber = args.flightNumber;
      if (args.origin !== undefined) booking.origin = args.origin;
      if (args.destination !== undefined) booking.destination = args.destination;
      if (args.date !== undefined) booking.date = args.date;
      if (args.seatClass !== undefined) booking.seatClass = args.seatClass;
      return booking;
    },

    // ADDED (Step 3): dedicated, safe mutation for the one status change
    // customers actually need -- cancelling their own booking. Only ever
    // does ONE specific, controlled transition (confirmed -> cancelled).
    cancelBooking: (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      const booking = bookings.find(b => b.id === args.id);
      if (!booking) return null;
      if (booking.userId !== context.user.id) {
        throw new Error('Forbidden: this booking does not belong to you');
      }
      if (booking.status === 'cancelled') {
        throw new Error('Booking is already cancelled');
      }
      booking.status = 'cancelled';
      return booking;
    },
    // CHANGED (Step 5 - fixes API5): deleteBooking is now admin-only.
    // Customers should use cancelBooking instead (Step 3) -- permanently
    // deleting a record is a staff-level action, kept separate from a
    // customer cancelling their own trip, matching the REST design.
    deleteBooking: (parent, args, context) => {
      requireRole(context.user, 'admin');
      const index = bookings.findIndex(b => b.id === args.id);
      if (index === -1) return false;
      bookings.splice(index, 1);
      return true;
    }
  }
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  // ADDED (Step 4e - fixes API4 + API8 Security Misconfiguration):
  // Introspection lets ANY caller ask the server "what can you do?" and
  // get back the entire schema -- every type, query, mutation, and
  // argument -- with no authentication needed. This is convenient
  // during development (tools like Postman/Sandbox use it to autocomplete
  // queries for you), but in production it hands an attacker your full
  // API surface for free, including operations like deleteBooking they
  // might not otherwise have known existed.
  //
  // We only enable it when NODE_ENV is NOT "production". Since this is
  // a local assignment, NODE_ENV is normally unset, so introspection
  // stays ON for your own testing -- but the pattern is correct and would
  // switch off automatically the moment NODE_ENV=production is set on
  // a real deployment.
  introspection: process.env.NODE_ENV !== 'production',

  // ADDED (Step 7b - fixes API8 Security Misconfiguration):
  // By default, Apollo Server includes a full stack trace (file paths,
  // line numbers, library internals) in every error response -- you've
  // seen this in every test so far. formatError runs on every error
  // before it's sent to the client, letting us strip those details out.
  // The original error.message (e.g. "Forbidden: ...", "Not authenticated")
  // is intentionally preserved, since those are meant to be seen by the
  // client -- only the internal stacktrace/debugging info is removed.
  formatError: (formattedError, error) => {
    console.error(error); // full details still go to YOUR server logs

    if (process.env.NODE_ENV === 'production') {
      // Strip everything except the safe, intentional message and code.
      return {
        message: formattedError.message,
        extensions: { code: formattedError.extensions?.code }
      };
    }
    // In local/dev: keep the message and code, but drop the stacktrace
    // specifically, since it's the part that leaks file paths internals.
    const { stacktrace, ...safeExtensions } = formattedError.extensions || {};
    return { ...formattedError, extensions: safeExtensions };
  }
});

async function startServer() {
  await server.start();

  const app = express();

  // ADDED (Step 7a - fixes API8 Security Misconfiguration):
  // Same protections as the REST version: helmet adds several
  // protective HTTP headers automatically.
  app.use(helmet());

  // ADDED (Step 7a): explicit CORS allow-list, instead of leaving
  // cross-origin behavior on default/unconfigured settings.
  const allowedOrigins = ['http://localhost:4000', 'http://localhost:5173'];
  app.use(cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  }));

  app.use(bodyParser.json());

  // ADDED (Step 4a - fixes API4 Unrestricted Resource Consumption):
  // Since GraphQL has only ONE url, we can't give /login its own
  // stricter limit the way we did with separate REST routes -- this
  // single limiter covers every query AND mutation that goes through
  // /graphql, including login attempts. 100 requests / 15 min per IP.
  const graphqlLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Too many requests, please try again later." }
  });
  app.use('/graphql', graphqlLimiter);

  // ADDED (Step 1 - fixes API2 Broken Authentication):
  // This `context` function runs ONCE per incoming HTTP request, BEFORE
  // any resolver executes. Its return value becomes the `context` argument
  // available inside every resolver. This is the GraphQL equivalent of
  // Express's `verifyToken` middleware -- except it doesn't block the
  // request itself (GraphQL has no concept of "this route requires auth"
  // at the transport level) -- it just makes `context.user` available
  // (or null) for EACH resolver to check individually.
  app.use('/graphql', expressMiddleware(server, {
    context: async ({ req }) => {
      const user = getUserFromToken(req.headers.authorization);
      return { user }; // user is null if not logged in / invalid token
    }
  }));

  const PORT = 4000;
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/graphql`);
  });
}

startServer();