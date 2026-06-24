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



# Booking GraphQL API Documentation

**Endpoint:** `http://localhost:4000/graphql` (single endpoint for all operations)

This document is the human-readable companion to the schema's built-in
descriptions (see `typeDefs` in `server.js`). The schema itself is also
self-documenting via GraphQL introspection -- any GraphQL client (Postman,
Apollo Sandbox, etc.) can query `__schema` to see every type, field, and
description directly. Keeping both in sync is part of fixing OWASP
API9:2023 - Improper Inventory Management.

---

## Data Sensitivity Note

`passengerName` is **personally identifiable information (PII)**. This is
documented directly on the field in the schema. Any resolver returning
this field must be access-controlled (see Auth column below).

---

## Authentication

All operations except `login` require a valid Bearer token:

```
Authorization: Bearer <token>
```

Get a token by calling the `login` mutation. Tokens expire after 1 hour.
Unlike REST, GraphQL has a single endpoint, so authentication is enforced
**inside each resolver** (via the `context.user` value) rather than per-route
middleware.

---

## Operations

| Type | Name | Auth Required | Role | Description |
|------|------|---------------|------|--------------|
| Mutation | `login` | No | Any | Authenticate with username + password, returns a JWT |
| Query | `bookings` | Yes | customer | Returns the logged-in user's own bookings (paginated) |
| Query | `bookingsAll` | Yes | **admin only** | Returns every booking in the system (paginated) |
| Query | `booking(id)` | Yes | customer (owner only) | Returns one booking, only if it belongs to the caller |
| Mutation | `createBooking` | Yes | customer | Creates a new booking for the logged-in user |
| Mutation | `updateBooking` | Yes | customer (owner only) | Updates editable fields (cannot change `status`) |
| Mutation | `cancelBooking` | Yes | customer (owner only) | Safely cancels the caller's own booking |
| Mutation | `deleteBooking` | Yes | **admin only** | Permanently deletes a booking record |

---

## Example Operations

### login
```graphql
mutation {
  login(username: "ali", password: "ali123")
}
```
Rate limited along with all other operations: max 100 requests per 15
minutes per IP (shared across the whole `/graphql` endpoint, since there
is only one URL -- unlike REST, login cannot easily have its own
stricter limit without inspecting the operation name).

---

### bookings
```graphql
query {
  bookings(page: 1, limit: 10) {
    page
    limit
    totalResults
    totalPages
    data { id passengerName flightNumber status }
  }
}
```
`limit` is capped at 50 server-side regardless of what is requested.

---

### bookingsAll
Same shape as `bookings`, but includes every user's bookings. Throws
`Forbidden: insufficient permissions for this action` if the caller is
not an admin.

---

### booking(id)
```graphql
query {
  booking(id: "1") { id passengerName status }
}
```
Throws `Forbidden: this booking does not belong to you` if the booking
exists but belongs to a different user.

---

### createBooking
```graphql
mutation {
  createBooking(
    passengerName: "John Doe"
    flightNumber: "TK123"
    origin: "Istanbul"
    destination: "London"
    date: "2026-08-01"
    seatClass: "Economy"
  ) { id status }
}
```
`seatClass` must be one of: `Economy`, `Premium Economy`, `Business`, `First`.

Business rule limits (demo values): max 5 confirmed bookings per
flightNumber+date combination, max 2 per individual user per
flightNumber+date. Exceeding either throws an error
(`"This flight is fully booked"` or `"You already have the maximum of 2
bookings on this flight"`).

Note: GraphQL allows multiple aliased mutations in a single request
(e.g. `a: createBooking(...) b: createBooking(...)`). These limits are
still enforced correctly because GraphQL mutations execute sequentially,
not in parallel, within one request.

---

### updateBooking
```graphql
mutation {
  updateBooking(id: "1", seatClass: "Business") { id seatClass }
}
```
Does **not** accept a `status` argument -- GraphQL rejects any attempt to
pass one at the schema-validation stage, before the resolver even runs.
Use `cancelBooking` to change status instead.

---

### cancelBooking
```graphql
mutation {
  cancelBooking(id: "1") { id status }
}
```
Throws `Booking is already cancelled` if called twice on the same booking.

---

### deleteBooking
```graphql
mutation {
  deleteBooking(id: "1")
}
```
Admin only. Returns `true`/`false`.

---

## Known Limitations (local/demo scope)

- Data is stored in memory only (`let bookings = [...]`) -- resets on
  every server restart. No real database is used.
- `JWT_SECRET` is hardcoded in `auth.js` for local development simplicity.
  In a real deployment this must be an environment variable.
- Introspection is enabled by default and only disabled when
  `NODE_ENV=production` is explicitly set. Locally, this means the full
  schema (including admin-only operations like `deleteBooking`) is
  discoverable by anyone who can reach the endpoint -- acceptable for
  local development, not for production.
- Rate limiting applies uniformly across the single `/graphql` endpoint;
  `login` does not have its own stricter limit the way REST's `/login`
  route does.
- `NODE_ENV` is not set in this local setup, so error responses retain
  their `message` and `code` but omit the `stacktrace` field regardless
  (see `formatError` in `server.js`).