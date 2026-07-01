import express from 'express';
import { handler } from './api/check.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  // `app.all` lets the handler keep its own method handling (405 on non-POST,
  // 200 on OPTIONS) and CORS headers, exactly as on Vercel.
  app.all('/api/check', handler);
  app.use(express.static('public'));
  // Map body-parser / unexpected errors to a clean JSON response instead of
  // leaking a stack trace (Express's default error page) to the caller.
  app.use((err, req, res, _next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      status: 'error',
      error: err.type === 'entity.parse.failed' ? 'Invalid JSON body' : 'Internal server error',
    });
  });
  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`hubspot-tracker-checker listening on port ${port}`);
  });
}
