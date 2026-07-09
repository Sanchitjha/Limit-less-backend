import { config } from '../config.js';

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `No route for ${req.method} ${req.originalUrl}`,
  });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }

  // Our validation errors keep the FastAPI-compatible shape the frontend parses
  if (err.status === 422 && err.detail) {
    return res.status(422).json({ detail: err.detail });
  }

  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  console.error(`[error] ${req.method} ${req.originalUrl} ->`, err);

  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
    ...(config.nodeEnv !== 'production' && status === 500 ? { message: err.message } : {}),
  });
};
