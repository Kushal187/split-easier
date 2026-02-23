import express from 'express';
import cors from 'cors';

import { connectDb } from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import householdRoutes from './routes/households.js';
import billRoutes from './routes/bills.js';
import splitwiseRoutes from './routes/splitwise.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();
const BODY_LIMIT = process.env.BODY_LIMIT || '12mb';

app.use((req, res, next) => {
  connectDb().then(() => next()).catch(next);
});
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

app.use('/api/auth', authRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/households', authMiddleware, householdRoutes);
app.use('/api/households/:householdId/bills', authMiddleware, billRoutes);
app.use('/api/splitwise', authMiddleware, splitwiseRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: `Upload is too large. Max request size is ${BODY_LIMIT}.` });
  }
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
});

export default app;
