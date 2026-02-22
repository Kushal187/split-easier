import './loadEnv.js';
import mongoose from 'mongoose';

import app from './app.js';

const PORT = process.env.SERVER_PORT || process.env.PORT || 3001;

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
