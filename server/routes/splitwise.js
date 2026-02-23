import { Router } from 'express';
import User from '../models/User.js';
import { splitwiseFetch, withSplitwiseAccessToken } from '../lib/splitwise.js';

const router = Router();

async function withSplitwise(req, res, next, fn) {
  try {
    const data = await withSplitwiseAccessToken(req.user.id, fn);
    return res.json(data);
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

router.get('/connection', async (req, res, next) => {
  try {
    const userDoc = await User.findById(req.user.id).select('splitwise');
    res.json({ connected: Boolean(userDoc?.splitwise?.accessToken), splitwiseUserId: userDoc?.splitwise?.id || null });
  } catch (err) {
    next(err);
  }
});

router.get('/current-user', (req, res, next) => {
  withSplitwise(req, res, next, (accessToken) => splitwiseFetch('/get_current_user', accessToken));
});

router.get('/groups', (req, res, next) => {
  withSplitwise(req, res, next, (accessToken) => splitwiseFetch('/get_groups', accessToken, { query: req.query }));
});

router.get('/expenses', (req, res, next) => {
  withSplitwise(req, res, next, (accessToken) => splitwiseFetch('/get_expenses', accessToken, { query: req.query }));
});

router.post('/expenses', (req, res, next) => {
  withSplitwise(req, res, next, (accessToken) => splitwiseFetch('/create_expense', accessToken, { method: 'POST', body: req.body }));
});

export default router;
