const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');

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
  const { url } = await startStandaloneServer(server, {
    listen: { port: 4000 }
  });
  console.log(`Server running at ${url}`);
}

startServer();