import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const SPLITWISE_BASE_URL = process.env.SPLITWISE_BASE_URL || 'https://secure.splitwise.com';
const SPLITWISE_API_BASE = process.env.SPLITWISE_API_BASE || 'https://secure.splitwise.com/api/v3.0';
const SPLITWISE_CLIENT_ID = process.env.SPLITWISE_CLIENT_ID;
const SPLITWISE_CLIENT_SECRET = process.env.SPLITWISE_CLIENT_SECRET;
const SPLITWISE_REDIRECT_URI = process.env.SPLITWISE_REDIRECT_URI || 'http://localhost:5173/api/auth/splitwise/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const SPLITWISE_STATE_SECRET = process.env.SPLITWISE_STATE_SECRET || JWT_SECRET;

function issueToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function getSplitwiseName(splitwiseUser) {
  const first = splitwiseUser?.first_name?.trim();
  const last = splitwiseUser?.last_name?.trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (splitwiseUser?.email?.trim()) return splitwiseUser.email.trim();
  return `Splitwise User ${splitwiseUser?.id || ''}`.trim();
}

function ensureSplitwiseEnv() {
  if (!SPLITWISE_CLIENT_ID || !SPLITWISE_CLIENT_SECRET || !SPLITWISE_REDIRECT_URI) {
    const err = new Error('Splitwise OAuth env vars are missing');
    err.status = 500;
    throw err;
  }
}

function buildFrontendCallbackUrl(payload = {}) {
  const hash = new URLSearchParams(payload).toString();
  return `${FRONTEND_URL.replace(/\/$/, '')}/oauth/splitwise/callback#${hash}`;
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email?.trim() || !password || !name?.trim()) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      email: email.trim().toLowerCase(),
      passwordHash,
      name: name.trim()
    });
    const token = issueToken(user._id);
    res.status(201).json({
      token,
      user: { id: user._id.toString(), email: user.email, name: user.name }
    });
  } catch (e) {
    next(e);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || !(await user.checkPassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = issueToken(user._id);
    res.json({
      token,
      user: { id: user._id.toString(), email: user.email, name: user.name }
    });
  } catch (e) {
    next(e);
  }
});

router.get('/splitwise/start', (req, res, next) => {
  try {
    ensureSplitwiseEnv();
    const state = jwt.sign({ t: Date.now(), ru: SPLITWISE_REDIRECT_URI }, SPLITWISE_STATE_SECRET, { expiresIn: '10m' });
    const params = new URLSearchParams({
      client_id: SPLITWISE_CLIENT_ID,
      response_type: 'code',
      redirect_uri: SPLITWISE_REDIRECT_URI,
      state
    });
    res.redirect(`${SPLITWISE_BASE_URL}/oauth/authorize?${params.toString()}`);
  } catch (e) {
    next(e);
  }
});

router.get('/splitwise/callback', async (req, res, next) => {
  try {
    ensureSplitwiseEnv();
    const { code, state } = req.query;
    if (!code || !state) {
      return res.redirect(buildFrontendCallbackUrl({ error: 'Missing authorization code or state' }));
    }

    let statePayload = null;
    try {
      statePayload = jwt.verify(String(state), SPLITWISE_STATE_SECRET);
    } catch (_) {
      return res.redirect(buildFrontendCallbackUrl({ error: 'Invalid or expired OAuth state' }));
    }
    const redirectUriFromState = statePayload?.ru || SPLITWISE_REDIRECT_URI;

    const tokenRes = await fetch(`${SPLITWISE_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        client_id: SPLITWISE_CLIENT_ID,
        client_secret: SPLITWISE_CLIENT_SECRET,
        redirect_uri: redirectUriFromState
      })
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData?.access_token) {
      const errorMessage = tokenData?.error_description || tokenData?.error || 'Failed to exchange Splitwise OAuth code';
      return res.redirect(buildFrontendCallbackUrl({ error: String(errorMessage) }));
    }

    const meRes = await fetch(`${SPLITWISE_API_BASE}/get_current_user`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const meData = await meRes.json().catch(() => ({}));
    const splitwiseUser = meData?.user;

    if (!meRes.ok || !splitwiseUser?.id) {
      const errorMessage = meData?.error || meData?.errors?.[0] || 'Unable to fetch Splitwise profile';
      return res.redirect(buildFrontendCallbackUrl({ error: String(errorMessage) }));
    }

    const splitwiseId = String(splitwiseUser.id);
    const splitwiseEmail = splitwiseUser?.email?.trim()?.toLowerCase() || null;

    let user = await User.findOne({ 'splitwise.id': splitwiseId });
    if (!user && splitwiseEmail) {
      user = await User.findOne({ email: splitwiseEmail });
    }

    const splitwiseDoc = {
      id: splitwiseId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      tokenType: tokenData.token_type || 'bearer',
      expiresAt: tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000) : null
    };

    if (!user) {
      user = await User.create({
        email: splitwiseEmail || `splitwise_${splitwiseId}@local.invalid`,
        name: getSplitwiseName(splitwiseUser),
        passwordHash: null,
        splitwise: splitwiseDoc
      });
    } else {
      user.splitwise = splitwiseDoc;
      if (!user.name?.trim()) user.name = getSplitwiseName(splitwiseUser);
      if (splitwiseEmail && user.email.endsWith('@local.invalid')) user.email = splitwiseEmail;
      await user.save();
    }

    const appToken = issueToken(user._id);
    const appUser = { id: user._id.toString(), email: user.email, name: user.name };

    return res.redirect(
      buildFrontendCallbackUrl({
        token: appToken,
        user: JSON.stringify(appUser)
      })
    );
  } catch (e) {
    next(e);
  }
});

export default router;
