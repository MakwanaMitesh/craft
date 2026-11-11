const session = require('express-session');
const MongoStore = require('connect-mongo');

function buildSessionMiddleware() {
  return session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: 'sessions',
    }),
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // blocks the cookie on cross-site POSTs (defense-in-depth alongside the CSRF token), while still allowing normal top-level link navigation
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  });
}

module.exports = buildSessionMiddleware;
