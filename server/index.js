import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import householdRoutes from './routes/households.js';
import billRoutes from './routes/bills.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/households', authMiddleware, householdRoutes);
app.use('/api/households/:householdId/bills', authMiddleware, billRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
});

async function start() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is required in .env');
  }
  await mongoose.connect(uri);
  console.log('MongoDB connected');

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
