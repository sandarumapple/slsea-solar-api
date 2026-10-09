const jwt = require('jsonwebtoken');
const {
  User,
  Province,
  District,
  GridSubstation,
  SolarInstallation
} = require('../models');
const { ApiError, notFound } = require('../utils/errors');

const forbidden = () =>
  new ApiError(403, 'FORBIDDEN', 'Outside your jurisdiction');
const same = (a, b) => String(a) === String(b);

async function authenticate(req, res, next) {
  try {
    const value = req.headers.authorization;
    if (!value?.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Bearer token required');
    }
    const claims = jwt.verify(value.slice(7), process.env.JWT_SECRET, {
      algorithms: ['HS256']
    });
    const user = await User.findById(claims.sub).lean();
    if (!user || !user.active) {
      throw new ApiError(
        401,
        'UNAUTHENTICATED',
        'Account is inactive or unavailable'
      );
    }
    req.auth = user;
    next();
  } catch (error) {
    next(
      [
        'JsonWebTokenError',
        'TokenExpiredError',
        'NotBeforeError',
        'CastError'
      ].includes(error.name)
        ? new ApiError(401, 'UNAUTHENTICATED', 'Invalid or expired token')
        : error
    );
  }
}

function requireRoles(...roles) {
  return (req, res, next) =>
    roles.includes(req.auth.role)
      ? next()
      : next(new ApiError(403, 'FORBIDDEN', 'Insufficient permissions'));
}

// Build the permitted hierarchy once per read request. Child collections always
// intersect these IDs, even when a parent is visible to a narrower jurisdiction.
async function readUser(req, res, next) {
  try {
    const user = req.auth;
    if (user.role === 'DEVICE') {
      throw new ApiError(
        403,
        'FORBIDDEN',
        'Metering devices are write-only clients'
      );
    }
    if (['ADMIN', 'SYSTEM_ADMIN'].includes(user.role) && (user.jurisdictionType !== 'NATIONAL' || user.jurisdictionRef)) throw forbidden();
    let districtFilter = {};
    let substationFilter = {};
    if (!['ADMIN', 'SYSTEM_ADMIN'].includes(user.role)) {
      const expected = {
        PROVINCE_OFFICER: 'PROVINCE',
        DISTRICT_OFFICER: 'DISTRICT',
        SUBSTATION_OFFICER: 'SUBSTATION'
      };
      if (
        expected[user.role] !== user.jurisdictionType ||
        !user.jurisdictionRef
      )
        throw forbidden();
      if (user.jurisdictionType === 'PROVINCE')
        districtFilter.province = user.jurisdictionRef;
      if (user.jurisdictionType === 'DISTRICT')
        districtFilter._id = user.jurisdictionRef;
      if (user.jurisdictionType === 'SUBSTATION') {
        const sub = await GridSubstation.findById(user.jurisdictionRef).lean();
        if (!sub) throw forbidden();
        districtFilter._id = sub.district;
        substationFilter._id = sub._id;
      }
    }
    const districts = await District.find(districtFilter)
      .select('_id province')
      .lean();
    const districtIds = districts.map((d) => d._id);
    const substations = await GridSubstation.find({
      ...substationFilter,
      district: { $in: districtIds }
    })
      .select('_id')
      .lean();
    let provinces;
    if (['ADMIN', 'SYSTEM_ADMIN'].includes(user.role))
      provinces = await Province.find().select('_id').lean();
    else if (user.jurisdictionType === 'PROVINCE')
      provinces = await Province.find({ _id: user.jurisdictionRef })
        .select('_id')
        .lean();
    else provinces = districts.map((d) => ({ _id: d.province }));
    req.scope = {
      provinces: provinces.map((p) => p._id),
      districts: districtIds,
      substations: substations.map((s) => s._id)
    };
    next();
  } catch (error) {
    next(error);
  }
}

async function canAccessInstallation(auth, installation) {
  if (['ADMIN', 'SYSTEM_ADMIN'].includes(auth.role)) return true;
  if (auth.role === 'DEVICE')
    return (
      auth.jurisdictionType === 'INSTALLATION' &&
      same(auth.jurisdictionRef, installation._id)
    );
  const sub = await GridSubstation.findById(installation.substation).lean();
  if (!sub) return false;
  if (
    auth.role === 'SUBSTATION_OFFICER' &&
    auth.jurisdictionType === 'SUBSTATION'
  )
    return same(auth.jurisdictionRef, sub._id);
  const district = await District.findById(sub.district).lean();
  if (!district) return false;
  if (auth.role === 'DISTRICT_OFFICER' && auth.jurisdictionType === 'DISTRICT')
    return same(auth.jurisdictionRef, district._id);
  return (
    auth.role === 'PROVINCE_OFFICER' &&
    auth.jurisdictionType === 'PROVINCE' &&
    same(auth.jurisdictionRef, district.province)
  );
}

async function authorizeInstallation(req, res, next) {
  try {
    const installation = await SolarInstallation.findById(
      req.params.installationId
    );
    if (!installation) throw notFound('Installation');
    if (!(await canAccessInstallation(req.auth, installation)))
      throw forbidden();
    req.installation = installation;
    next();
  } catch (error) {
    next(error);
  }
}

function authorizeScope(model, parameter, key) {
  return async (req, res, next) => {
    try {
      const item = await model.findById(req.params[parameter]).lean();
      if (!item) throw notFound(model.modelName);
      if (!req.scope[key].some((id) => same(id, item._id))) throw forbidden();
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  authenticate,
  requireRoles,
  readUser,
  canAccessInstallation,
  authorizeInstallation,
  authorizeProvince: authorizeScope(Province, 'provinceId', 'provinces'),
  authorizeDistrict: authorizeScope(District, 'districtId', 'districts'),
  authorizeSubstation: authorizeScope(
    GridSubstation,
    'substationId',
    'substations'
  )
};
