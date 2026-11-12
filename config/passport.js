const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

// `session: false` everywhere this strategy is used (see routes/authRoutes.js)
// — this app manages its own session (req.session.userId/userName/role,
// see controllers/authController.js) rather than passport's serialize/
// deserialize layer, so passport here is only the OAuth handshake, not a
// second parallel session system.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.BASE_URL}/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) return done(null, false, { message: 'Google did not share an email address.' });

          let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });
          if (!user) {
            user = await User.create({ name: profile.displayName || 'Google user', email, googleId: profile.id });
          } else if (!user.googleId) {
            // An existing email/password account signing in with Google for
            // the first time — link the two rather than creating a duplicate.
            user.googleId = profile.id;
            await user.save();
          }

          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

module.exports = passport;
