import express from 'express';
import { handler } from './api/check.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  // `app.all` lets the handler keep its own method handling (405 on non-POST,
  // 200 on OPTIONS) and CORS headers, exactly as on Vercel.
  app.all('/api/check', handler);
  app.use(express.static('public'));
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`hubspot-tracker-checker listening on port ${port}`);
  });
}
