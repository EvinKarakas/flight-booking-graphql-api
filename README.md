# Flight Booking GraphQL API

A simple GraphQL API built with Node.js and Apollo Server for managing flight bookings. This project was built as a learning exercise to understand GraphQL concepts, including schemas, resolvers, queries, and mutations — and to compare GraphQL directly against an equivalent REST API.

## Tech Stack

- Node.js
- Apollo Server
- GraphQL
- In-memory array (no external database)

## How to Run

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   node server.js
   ```
4. The server will run at `http://localhost:4000`
5. Open `http://localhost:4000` in your browser to use Apollo Sandbox and test queries/mutations interactively

## Schema

```graphql
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
```

## Queries

### Get all bookings
```graphql
query {
  bookings {
    id
    passengerName
    flightNumber
    origin
    destination
    date
    seatClass
    status
  }
}
```

### Get a single booking by id
```graphql
query {
  booking(id: "1") {
    passengerName
    status
  }
}
```

## Mutations

### Create a new booking
```graphql
mutation {
  createBooking(
    passengerName: "Elif Demir"
    flightNumber: "TK5678"
    origin: "Ankara"
    destination: "Paris"
    date: "2026-08-01"
    seatClass: "Business"
  ) {
    id
    passengerName
    status
  }
}
```

### Update a booking
```graphql
mutation {
  updateBooking(
    id: "2"
    seatClass: "First"
    status: "confirmed"
  ) {
    id
    passengerName
    seatClass
    status
  }
}
```

### Delete a booking
```graphql
mutation {
  deleteBooking(id: "2")
}
```

## Notes

This project uses an in-memory array instead of a real database. This means all data resets to its initial state every time the server restarts. This was an intentional choice to keep the project focused on learning GraphQL fundamentals.

Unlike the REST version of this project, the `updateBooking` mutation only updates fields that are explicitly provided, leaving all other fields untouched. This is closer to a PATCH-style partial update than a PUT-style full replacement.