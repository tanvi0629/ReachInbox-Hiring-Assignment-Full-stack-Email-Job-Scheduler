import { Router, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { query } from '../db/pool';
import dotenv from 'dotenv';
dotenv.config();

const router = Router();

/** Sign a state value with HMAC-SHA256 to prevent CSRF */
function signState(userId: string): string {
  const secret = process.env.JWT_SECRET || 'secret';
  const hmac = crypto.createHmac('sha256', secret).update(userId).digest('hex');
  return `${userId}.${hmac}`;
}

/** Verify signed state; returns userId if valid, null if tampered */
function verifyState(state: string): string | null {
  const dotIndex = state.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const userId = state.slice(0, dotIndex);
  const expected = signState(userId);
  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return null;
  return userId;
}

// Redirect user to Slack OAuth
router.get('/connect', authMiddleware, (req: AuthRequest, res: Response) => {
  const userId = req.auth!.userId;
  const state = signState(userId);
  const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=chat:write,channels:read,incoming-webhook&redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI || '')}&state=${encodeURIComponent(state)}`;
  res.json({ authUrl: slackAuthUrl });
});

// Slack OAuth callback
router.get('/callback', async (req, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?slack_error=${error}`);
    return;
  }

  // Verify CSRF state
  const userId = state ? verifyState(decodeURIComponent(state as string)) : null;
  if (!userId) {
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?slack_error=invalid_state`);
    return;
  }

  try {
    const response = await axios.post('https://slack.com/api/oauth.v2.access', null, {
      params: {
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: process.env.SLACK_REDIRECT_URI,
      },
    });

    // Slack always returns 200; check the ok field for real errors
    if (!response.data.ok) {
      console.error('Slack OAuth error:', response.data.error);
      res.redirect(`${process.env.FRONTEND_URL}/dashboard?slack_error=oauth_failed`);
      return;
    }

    const { access_token, team, incoming_webhook } = response.data;
    const channelId = incoming_webhook?.channel_id || null;

    await query(
      `UPDATE users SET slack_access_token = $1, slack_team_id = $2, slack_channel_id = $3, updated_at = NOW() WHERE id = $4`,
      [access_token, team?.id, channelId, userId]
    );

    res.redirect(`${process.env.FRONTEND_URL}/dashboard?slack_connected=true`);
  } catch (err) {
    console.error('Slack OAuth error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/dashboard?slack_error=oauth_failed`);
  }
});

// Disconnect Slack
router.delete('/disconnect', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await query(
      `UPDATE users SET slack_access_token = NULL, slack_channel_id = NULL, slack_team_id = NULL WHERE id = $1`,
      [req.auth!.userId]
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to disconnect Slack' });
  }
});

// Get Slack connection status
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT slack_access_token IS NOT NULL as connected, slack_team_id FROM users WHERE id = $1`,
      [req.auth!.userId]
    );
    res.json(result.rows[0] || { connected: false });
  } catch {
    res.status(500).json({ error: 'Failed to get Slack status' });
  }
});

export default router;
