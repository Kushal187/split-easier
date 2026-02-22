import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required in .env');
}

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    User.findById(payload.userId)
      .then((user) => {
        if (!user) {
          return res.status(401).json({ error: 'User not found' });
        }
        req.user = { id: user._id.toString(), email: user.email, name: user.name };
        next();
      })
      .catch(next);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
