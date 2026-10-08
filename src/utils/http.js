const crypto = require('crypto');
const { ApiError } = require('./errors');

function latestModification(value) {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value))
    return value.reduce(
      (max, item) => Math.max(max, latestModification(item)),
      0
    );
  let max = 0;
  for (const [key, item] of Object.entries(value)) {
    if (['createdAt', 'updatedAt'].includes(key))
      max = Math.max(max, new Date(item).getTime() || 0);
    else if (item && typeof item === 'object' && !(item instanceof Date))
      max = Math.max(max, latestModification(item));
  }
  return max;
}

function conditional(req, res, value, modified) {
  const tag = `"${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}"`;
  res.set({
    ETag: tag,
    'Cache-Control': 'private, no-cache',
    Vary: 'Authorization, Accept'
  });
  const time = new Date(modified || latestModification(value)).getTime();
  if (time > 0) res.set('Last-Modified', new Date(time).toUTCString());
  const match = req.headers['if-match'];
  if (match !== undefined && !match.split(',').some(
    (candidate) => candidate.trim() === '*' || candidate.trim() === tag
  )) throw new ApiError(412, 'PRECONDITION_FAILED', 'If-Match does not match the current representation');
  const unmodified = Date.parse(req.headers['if-unmodified-since']);
  if (match === undefined && time > 0 && Number.isFinite(unmodified) &&
      Math.floor(time / 1000) > Math.floor(unmodified / 1000))
    throw new ApiError(412, 'PRECONDITION_FAILED', 'Resource changed after If-Unmodified-Since');
  const tags = req.headers['if-none-match'];
  if (tags !== undefined)
    return tags
      .split(',')
      .some(
        (candidate) =>
          candidate.trim() === '*' ||
          candidate.trim().replace(/^W\//, '') === tag
      );
  const since = Date.parse(req.headers['if-modified-since']);
  // HTTP dates have second precision. Require an older representation before
  // trusting a date-only validator; ETags handle writes within the current second.
  return (
    time > 0 &&
    Number.isFinite(since) &&
    since <= Date.now() &&
    Math.floor(time / 1000) < Math.floor(Date.now() / 1000) &&
    Math.floor(time / 1000) <= Math.floor(since / 1000)
  );
}

function send(req, res, body, modified) {
  if (conditional(req, res, body, modified)) return res.status(304).end();
  return res.json(body);
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${name} must be a positive integer`
    );
  }
  return Number(value);
}

function paginate(req, total) {
  const page = positiveInteger(req.query.page, 1, 'page');
  const pageSize = Math.min(
    100,
    positiveInteger(req.query.pageSize, 20, 'pageSize')
  );
  const skip = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skip))
    throw new ApiError(400, 'VALIDATION_ERROR', 'Page is too large');
  const totalPages = Math.ceil(total / pageSize);
  const base = `${req.baseUrl}${req.path}`;
  const url = (p) =>
    `${base}?${new URLSearchParams({ ...req.query, page: p, pageSize }).toString()}`;
  return {
    page,
    pageSize,
    totalPages,
    skip,
    response: { page, pageSize, totalCount: total, totalPages },
    links: {
      self: url(page),
      next: page < totalPages ? url(page + 1) : null,
      previous: page > 1 ? url(page - 1) : null
    }
  };
}

function timestamp(value, name) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
      value
    ) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${name} must be an ISO 8601 timestamp with a timezone`
    );
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  )
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${name} contains an invalid calendar date or time`
    );
  return new Date(value);
}
module.exports = { conditional, send, paginate, timestamp, latestModification };
