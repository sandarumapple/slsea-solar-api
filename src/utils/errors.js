class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    Object.assign(this, { status, code, detail });
  }
}
const notFound = (resource = 'Resource') =>
  new ApiError(404, 'NOT_FOUND', `${resource} not found`);
module.exports = { ApiError, notFound };
