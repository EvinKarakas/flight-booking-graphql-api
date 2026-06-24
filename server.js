const express = require('express');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@as-integrations/express5');
const bodyParser = require('body-parser');
const { login, getUserFromToken } = require('./auth');

// CHANGED (Step 1 - fixes API2 Broken Authentication):
// Added a "login" mutation to the schema.
const typeDefs = `
  type Booking {
    id: ID!
    userId: ID!
    passengerName: String!
    flightNumber: String!
    origin: String!
    destination: String!
    date: String!
    seatClass: String!
    status: String!
  }
  type Query {
    bookings: [Booking!]!
    booking(id: ID!): Booking
  }
  type Mutation {
    login(username: String!, password: String!): String!
    createBooking(passengerName: String!, flightNumber: String!, origin: String!, destination: String!, date: String!, seatClass: String!): Booking!
    updateBooking(id: ID!, passengerName: String, flightNumber: String, origin: String, destination: String, date: String, seatClass: String): Booking
    cancelBooking(id: ID!): Booking
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

const resolvers = {
  Query: {
    // CHANGED (Step 2 - fixes API1 BOLA): now requires login (context.user),
    // and only returns bookings belonging to the logged-in user.
    // context is the 3rd resolver argument -- this is the GraphQL
    // equivalent of checking req.user in an Express route handler.
    bookings: (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      return bookings.filter(b => b.userId === context.user.id);
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
    // CHANGED (Step 2 - fixes API1 BOLA): requires login and ownership.
    // NOTE: in Step 5 this will be further restricted to admin-only,
    // matching the REST version's DELETE /bookings/:id design.
    deleteBooking: (parent, args, context) => {
      if (!context.user) {
        throw new Error('Not authenticated');
      }
      const booking = bookings.find(b => b.id === args.id);
      if (!booking) return false;
      if (booking.userId !== context.user.id) {
        throw new Error('Forbidden: this booking does not belong to you');
      }
      const index = bookings.findIndex(b => b.id === args.id);
      bookings.splice(index, 1);
      return true;
    }
  }
};

const server = new ApolloServer({
  typeDefs,
  resolvers
});

async function startServer() {
  await server.start();

  const app = express();
  app.use(bodyParser.json());

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