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
    updateBooking(id: ID!, passengerName: String, flightNumber: String, origin: String, destination: String, date: String, seatClass: String, status: String): Booking
    deleteBooking(id: ID!): Boolean!
  }
`;

let bookings = [
  {
    id: "1",
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
    bookings: () => bookings,
    booking: (parent, args) => bookings.find(b => b.id === args.id)
  },
  Mutation: {
    // ADDED (Step 1 - fixes API2): login mutation. Same logic as the
    // REST /login route, just exposed as a GraphQL mutation instead of
    // an HTTP route. Returns a JWT string the client must send back as
    // "Authorization: Bearer <token>" on every subsequent request.
    login: (parent, args) => {
      return login(args.username, args.password);
    },

    createBooking: (parent, args) => {
      const newBooking = {
        id: String(nextId++),
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
    updateBooking: (parent, args) => {
      const booking = bookings.find(b => b.id === args.id);
      if (!booking) return null;
      if (args.passengerName !== undefined) booking.passengerName = args.passengerName;
      if (args.flightNumber !== undefined) booking.flightNumber = args.flightNumber;
      if (args.origin !== undefined) booking.origin = args.origin;
      if (args.destination !== undefined) booking.destination = args.destination;
      if (args.date !== undefined) booking.date = args.date;
      if (args.seatClass !== undefined) booking.seatClass = args.seatClass;
      if (args.status !== undefined) booking.status = args.status;
      return booking;
    },
    deleteBooking: (parent, args) => {
      const index = bookings.findIndex(b => b.id === args.id);
      if (index === -1) return false;
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