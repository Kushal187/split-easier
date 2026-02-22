import { Router } from 'express';
import User from '../models/User.js';

const router = Router();

router.get('/me', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name
    });
  } catch (e) {
    next(e);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q ?? '').trim().toLowerCase();
    if (q.length < 2) {
      return res.json([]);
    }
    const users = await User.find({ email: new RegExp(q, 'i') })
      .select('email name _id')
      .limit(10)
      .lean();
    res.json(
      users.map((u) => ({
        id: u._id.toString(),
        email: u.email,
        name: u.name
      }))
    );
  } catch (e) {
    next(e);
  }
});

export default router;
