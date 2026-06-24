const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Same simplification as the REST version: hardcoded for local dev only.
// In a real deployment this must be an environment variable.
const JWT_SECRET = 'local-dev-secret-change-in-real-app';

// --- Fake "users table" since there is no real database ---
let users = [
  {
    id: 1,
    username: 'ali',
    passwordHash: bcrypt.hashSync('ali123', 10), // plain password: ali123
    role: 'customer'
  },
  {
    id: 2,
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10), // plain password: admin123
    role: 'admin'
  },
  {
    id: 3,
    username: 'caleb',
    passwordHash: bcrypt.hashSync('caleb123', 10), // plain password: caleb123
    role: 'customer'
  }
];

// --- login() ---
// In GraphQL this is exposed as a Mutation (see schema), not a REST route,
// but the underlying logic is identical to the REST version's /login.
function login(username, password) {
  if (!username || !password) {
    throw new Error('username and password are required');
  }

  const user = users.find(u => u.username === username);

  // Same fix as REST: identical error for "no such user" and "wrong password",
  // so we never reveal which usernames exist.
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    throw new Error('Invalid username or password');
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  return token;
}

// --- getUserFromToken() ---
// GraphQL has no per-route middleware. Instead, this function runs ONCE per
// incoming HTTP request, inside the `context` function we will wire into
// Apollo Server. Its result becomes available to EVERY resolver as the
// third argument: (parent, args, context) => { ... context.user ... }
function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null; // not logged in -- resolvers decide what to do with this
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded; // { id, username, role, iat, exp }
  } catch (err) {
    return null; // invalid/expired token -- treated as "not logged in"
  }
}

module.exports = { login, getUserFromToken, users };