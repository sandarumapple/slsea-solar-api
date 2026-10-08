const { rateLimit } = require('express-rate-limit');
const { ApiError } = require('../utils/errors');

// Per-process protection. Use a shared store before scaling to multiple instances.
module.exports = function createLoginLimit(options = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(req, res, next) {
      next(new ApiError(429, 'RATE_LIMITED', 'Too many login attempts',
        'Wait for the Retry-After interval before trying again.'));
    },
    ...options
  });
};
