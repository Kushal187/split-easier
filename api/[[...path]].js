import { connectDb } from '../server/db.js';
import app from '../server/app.js';

export default async function handler(req, res) {
  await connectDb();
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return new Promise((resolve, reject) => {
    app(req, res);
    res.on('finish', resolve);
    res.on('error', reject);
  });
}
