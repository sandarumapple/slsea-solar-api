const { ApiError } = require('../utils/errors');
function notFoundHandler(req, res) {
  res
    .set('Cache-Control', 'no-store')
    .status(404)
    .json({
      code: 'NOT_FOUND',
      message: 'Route not found',
      detail: `${req.method} ${req.path}`
    });
}
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = 500;
  let code = 'INTERNAL_ERROR';
  if (err instanceof ApiError) {
    status = err.status;
    code = err.code;
  } else if (
    ['ValidationError', 'CastError', 'StrictModeError'].includes(err.name)
  ) {
    status = 400;
    code = 'VALIDATION_ERROR';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
  } else if (err.status >= 400 && err.status < 500) {
    status = err.status;
    code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
  }
  if (status === 500) console.error(err);
  const message =
    status === 500
      ? 'An unexpected error occurred'
      : err.type === 'entity.parse.failed'
        ? 'Request body contains invalid JSON'
        : err.message;
  res.set('Cache-Control', 'no-store');
  if (status === 401) res.set('WWW-Authenticate', 'Bearer realm="solar-api"');
  res
    .status(status)
    .json({
      code,
      message,
      detail:
        status === 500
          ? 'Contact the API operator if this persists.'
          : err.detail || message
    });
}
module.exports = { notFoundHandler, errorHandler };
