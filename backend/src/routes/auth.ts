
import { Router, Request, Response } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool';
import { User } from '../types';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        'http://localhost:3001/auth/google/callback',
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || '';
        const name = profile.displayName;
        const avatar = profile.photos?.[0]?.value;
        const googleId = profile.id;

        const existing = await query(
          'SELECT * FROM users WHERE google_id = $1',
          [googleId]
        );

        let user: User;

        if (existing.rows.length > 0) {
          const updated = await query(
            `UPDATE users
             SET name = $1, avatar = $2, updated_at = NOW()
             WHERE google_id = $3
             RETURNING *`,
            [name, avatar, googleId]
          );

          user = updated.rows[0] as User;
        } else {
          const result = await query(
            `INSERT INTO users (google_id, email, name, avatar)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [googleId, email, name, avatar]
          );

          user = result.rows[0] as User;
        }

        return done(null, user);
      } catch (err) {
        return done(err as Error);
      }
    }
  )
);

// Google login
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })
);

// Google callback
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=auth_failed`,
  }),
  (req: Request, res: Response) => {
    const user = req.user as unknown as User;

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.redirect(
      `${process.env.FRONTEND_URL}/auth/callback?token=${token}`
    );
  }
);

// Get current user
router.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || 'secret'
    );

    res.json({ user: payload });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
