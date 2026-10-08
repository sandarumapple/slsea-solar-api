const router = require('express').Router();
const c = require('../controllers/resourceController');
const auth = require('../controllers/authController');
const {
  authenticate,
  readUser,
  requireRoles,
  authorizeProvince,
  authorizeDistrict,
  authorizeSubstation,
  authorizeInstallation
} = require('../middleware/auth');
const { ApiError } = require('../utils/errors');

for (const name of [
  'provinceId',
  'districtId',
  'substationId',
  'installationId',
  'readingId'
]) {
  router.param(name, (req, res, next, value) =>
    /^[a-f\d]{24}$/i.test(value)
      ? next()
      : next(
          new ApiError(
            400,
            'VALIDATION_ERROR',
            `${name} must be a MongoDB ObjectId`
          )
        )
  );
}
router.get('/', (req, res) =>
  res.json({
    name: 'SLSEA Real-Time Solar Generation Data API',
    documentation: '/api/docs',
    authentication: '/api/auth/login',
    resources: ['/api/me', '/api/provinces', '/api/districts', '/api/substations', '/api/installations', '/api/readings']
  })
);
router.post('/auth/login', require('../middleware/loginLimit')(), auth.login);
const read = [authenticate, readUser];
const automaticRead = [...read, (req, res, next) => {
  if (Object.keys(req.query).length)
    return next(new ApiError(400, 'VALIDATION_ERROR', 'This resource derives scope from your account and does not accept query parameters'));
  next();
}];
router.get('/me', ...automaticRead, c.myContext);
router.get('/provinces', ...read, c.provinces);
router.get('/provinces/:provinceId', ...read, authorizeProvince, c.province);
router.get(
  '/provinces/:provinceId/districts',
  ...read,
  authorizeProvince,
  c.districts
);
router.get('/districts', ...automaticRead, c.districts);
router.get('/districts/:districtId', ...read, authorizeDistrict, c.district);
router.get(
  '/districts/:districtId/substations',
  ...read,
  authorizeDistrict,
  c.substations
);
router.get(
  '/districts/:districtId/generation-summary',
  ...read,
  authorizeDistrict,
  c.summary
);
router.get('/substations', ...automaticRead, c.substations);
router.get(
  '/substations/:substationId',
  ...read,
  authorizeSubstation,
  c.substation
);
router.get(
  '/substations/:substationId/installations',
  ...read,
  authorizeSubstation,
  c.installations
);
router.get('/installations', ...automaticRead, c.installations);
router.get(
  '/installations/:installationId',
  ...read,
  authorizeInstallation,
  c.installation
);
router.get(
  '/installations/:installationId/last-reading',
  ...read,
  authorizeInstallation,
  c.lastReading
);
router.get(
  '/installations/:installationId/readings',
  ...read,
  authorizeInstallation,
  c.readings
);
router.get(
  '/installations/:installationId/readings/:readingId',
  ...read,
  authorizeInstallation,
  c.reading
);
router.get('/readings', ...read, c.readings);
router.post(
  '/installations/:installationId/readings',
  authenticate,
  requireRoles('DEVICE'),
  authorizeInstallation,
  c.createReading
);

// Readings are append-only. Known resources report unsupported methods explicitly.
const methods = new Map();
for (const layer of router.stack) {
  if (!layer.route) continue;
  const set = methods.get(layer.route.path) || new Set();
  for (const method of Object.keys(layer.route.methods))
    set.add(method.toUpperCase());
  methods.set(layer.route.path, set);
}
for (const [path, verbs] of methods) {
  if (verbs.has('GET')) verbs.add('HEAD');
  verbs.add('OPTIONS');
  router.all(path, (req, res, next) => {
    res.set('Allow', [...verbs].join(', '));
    if (req.method === 'OPTIONS') return res.status(204).end();
    next(
      new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not supported for this resource',
        'Generation readings are append-only; SLSEA users are read-only.'
      )
    );
  });
}
module.exports = router;
