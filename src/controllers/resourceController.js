const {
  Province,
  District,
  GridSubstation,
  SolarInstallation,
  GenerationReading
} = require('../models');
const { ApiError, notFound } = require('../utils/errors');
const { send, paginate, timestamp, latestModification } = require('../utils/http');
const hierarchy = {
  path: 'substation',
  populate: { path: 'district', populate: { path: 'province' } }
};

exports.myContext = async (req, res) => {
  const user = req.auth;
  let resource = null;
  if (user.role !== 'ADMIN') {
    const assigned = {
      PROVINCE_OFFICER: { model: Province, key: 'provinces' },
      DISTRICT_OFFICER: { model: District, key: 'districts', populate: 'province' },
      SUBSTATION_OFFICER: {
        model: GridSubstation,
        key: 'substations',
        populate: { path: 'district', populate: { path: 'province' } }
      }
    }[user.role];
    if (!assigned || !req.scope[assigned.key].some(
      (id) => String(id) === String(user.jurisdictionRef)
    )) throw new ApiError(403, 'FORBIDDEN', 'Assigned jurisdiction is unavailable');
    let query = assigned.model.findById(user.jurisdictionRef);
    if (assigned.populate) query = query.populate(assigned.populate);
    resource = await query.lean();
    if (!resource) throw new ApiError(403, 'FORBIDDEN', 'Assigned jurisdiction is unavailable');
  }
  return send(req, res, {
    user: {
      id: String(user._id),
      name: user.name,
      role: user.role,
      jurisdictionType: user.jurisdictionType
    },
    jurisdiction: { type: user.jurisdictionType, resource },
    links: {
      self: '/api/me',
      provinces: '/api/provinces',
      districts: '/api/districts',
      substations: '/api/substations',
      installations: '/api/installations',
      readings: '/api/readings'
    }
  }, Math.max(new Date(user.updatedAt).getTime() || 0, latestModification(resource)));
};

exports.provinces = async (req, res) =>
  send(
    req,
    res,
    await Province.find({ _id: { $in: req.scope.provinces } })
      .sort('name')
      .lean()
  );
exports.province = async (req, res) =>
  send(req, res, await Province.findById(req.params.provinceId).lean());
exports.districts = async (req, res) =>
  send(
    req,
    res,
    await District.find({
      ...(req.params.provinceId ? { province: req.params.provinceId } : {}),
      _id: { $in: req.scope.districts }
    })
      .populate('province')
      .sort('name')
      .lean()
  );
exports.district = async (req, res) =>
  send(
    req,
    res,
    await District.findById(req.params.districtId).populate('province').lean()
  );
exports.substations = async (req, res) =>
  send(
    req,
    res,
    await GridSubstation.find({
      ...(req.params.districtId ? { district: req.params.districtId } : {}),
      _id: { $in: req.scope.substations }
    })
      .populate('district')
      .sort('name')
      .lean()
  );
exports.substation = async (req, res) =>
  send(
    req,
    res,
    await GridSubstation.findById(req.params.substationId)
      .populate({ path: 'district', populate: { path: 'province' } })
      .lean()
  );
exports.installations = async (req, res) =>
  send(
    req,
    res,
    await SolarInstallation.find({
      substation: req.params.substationId || { $in: req.scope.substations }
    })
      .populate(hierarchy)
      .sort('installationId')
      .lean()
  );

exports.installation = async (req, res) => {
  const item = await SolarInstallation.findById(req.params.installationId)
    .populate(hierarchy)
    .lean();
  if (!item) throw notFound('Installation');
  const latest = await GenerationReading.findOne({ installation: item._id })
    .sort({ timestamp: -1, _id: -1 })
    .lean();
  return send(req, res, {
    ...item,
    lastKnownReading: latest
      ? { ...latest, status: latest.powerKw > 0 ? 'GENERATING' : 'IDLE' }
      : null
  });
};
exports.lastReading = async (req, res) => {
  const reading = await GenerationReading.findOne({
    installation: req.installation._id
  })
    .sort({ timestamp: -1, _id: -1 })
    .lean();
  if (!reading) throw notFound('Generation reading');
  // Timestamp lets clients compute age without changing the cached representation.
  return send(req, res, {
    ...reading,
    status: reading.powerKw > 0 ? 'GENERATING' : 'IDLE'
  });
};
exports.reading = async (req, res) => {
  const reading = await GenerationReading.findOne({
    _id: req.params.readingId,
    installation: req.installation._id
  }).lean();
  if (!reading) throw notFound('Generation reading');
  return send(req, res, reading);
};

async function historyInstallationIds(req) {
  if (req.installation) return [req.installation._id];
  const { provinceId, districtId, substationId } = req.query;
  for (const [name, value, key] of [
    ['provinceId', provinceId, 'provinces'],
    ['districtId', districtId, 'districts'],
    ['substationId', substationId, 'substations']
  ]) {
    if (value !== undefined) {
      if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value))
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `${name} must be a MongoDB ObjectId`
        );
      if (!req.scope[key].some((id) => String(id).toLowerCase() === value.toLowerCase()))
        throw new ApiError(403, 'FORBIDDEN', 'Outside your jurisdiction');
    }
  }
  const districts = await District.find({
    _id: districtId || { $in: req.scope.districts },
    ...(provinceId ? { province: provinceId } : {})
  })
    .select('_id')
    .lean();
  const subs = await GridSubstation.find({
    _id: substationId || { $in: req.scope.substations },
    district: { $in: districts.map((d) => d._id) }
  })
    .select('_id')
    .lean();
  const installations = await SolarInstallation.find({
    substation: { $in: subs.map((s) => s._id) }
  })
    .select('_id')
    .lean();
  return installations.map((i) => i._id);
}

exports.readings = async (req, res) => {
  const allowed = [
    'page',
    'pageSize',
    'from',
    'to',
    'order',
    ...(req.installation ? [] : ['provinceId', 'districtId', 'substationId'])
  ];
  for (const key of Object.keys(req.query))
    if (!allowed.includes(key))
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `Unknown query parameter: ${key}`
      );
  paginate(req, 0);
  if (
    req.query.order !== undefined &&
    !['asc', 'desc'].includes(req.query.order)
  )
    throw new ApiError(400, 'VALIDATION_ERROR', 'order must be asc or desc');
  const q = { installation: { $in: await historyInstallationIds(req) } };
  if (req.query.from !== undefined || req.query.to !== undefined) {
    q.timestamp = {};
    if (req.query.from !== undefined)
      q.timestamp.$gte = timestamp(req.query.from, 'from');
    if (req.query.to !== undefined)
      q.timestamp.$lte = timestamp(req.query.to, 'to');
    if (q.timestamp.$gte > q.timestamp.$lte)
      throw new ApiError(400, 'VALIDATION_ERROR', 'from must not be after to');
  }
  const total = await GenerationReading.countDocuments(q);
  const p = paginate(req, total);
  const direction = req.query.order === 'asc' ? 1 : -1;
  const data = await GenerationReading.find(q)
    .sort({ timestamp: direction, _id: direction })
    .skip(p.skip)
    .limit(p.pageSize)
    .lean();
  const latestWrite = await GenerationReading.findOne(q)
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean();
  return send(
    req,
    res,
    { data, pagination: p.response, links: p.links },
    latestWrite?.createdAt
  );
};

exports.createReading = async (req, res) => {
  if (!req.installation.active)
    throw new ApiError(403, 'FORBIDDEN', 'Installation is inactive');
  const {
    timestamp: value,
    powerKw,
    cumulativeEnergyKwh,
    voltage
  } = req.body || {};
  const ts = timestamp(value, 'timestamp');
  if (
    ![powerKw, cumulativeEnergyKwh, voltage].every(Number.isFinite) ||
    powerKw < 0 ||
    powerKw > req.installation.capacityKw * 1.2 ||
    cumulativeEnergyKwh < 0 ||
    voltage < 100 ||
    voltage > 500 ||
    ts.getTime() > Date.now() + 300000
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Invalid reading values',
      'Use finite non-negative power/energy, voltage 100–500 V, power at most 120% of capacity, and a timestamp no more than five minutes in the future.'
    );
  }
  try {
    const reading = await GenerationReading.create({
      installation: req.installation._id,
      timestamp: ts,
      powerKw,
      cumulativeEnergyKwh,
      voltage
    });
    return res
      .location(
        `/api/installations/${req.installation._id}/readings/${reading._id}`
      )
      .status(201)
      .json(reading);
  } catch (error) {
    if (error.code === 11000)
      throw new ApiError(
        409,
        'DUPLICATE_READING',
        'A reading already exists at this timestamp'
      );
    throw error;
  }
};

exports.summary = async (req, res) => {
  const subs = await GridSubstation.find({
    district: req.params.districtId,
    _id: { $in: req.scope.substations }
  })
    .select('_id')
    .lean();
  const installations = await SolarInstallation.find({
    substation: { $in: subs.map((s) => s._id) },
    active: true
  })
    .select('_id')
    .lean();
  const ids = installations.map((i) => i._id);
  const now = Date.now();
  const offset = 330 * 60000;
  const start = new Date(
    Math.floor((now + offset) / 86400000) * 86400000 - offset
  );
  const totals = await GenerationReading.aggregate([
    {
      $match: {
        installation: { $in: ids },
        timestamp: { $gte: new Date(start.getTime() - 30 * 60000), $lte: new Date(now) }
      }
    },
    {
      $setWindowFields: {
        partitionBy: '$installation',
        sortBy: { timestamp: 1 },
        output: { nextTimestamp: { $shift: { output: '$timestamp', by: 1, default: null } } }
      }
    },
    { $sort: { timestamp: 1 } },
    {
      $group: {
        _id: '$installation',
        powerKw: { $last: '$powerKw' },
        timestamp: { $last: '$timestamp' },
        // Hold each sample until the next sample, now, or 30 minutes,
        // whichever comes first. Clip intervals to the Colombo day.
        todayEnergyKwh: {
          $sum: {
            $multiply: [
              '$powerKw',
              { $divide: [
                { $max: [0, { $subtract: [
                  { $min: [
                    { $ifNull: ['$nextTimestamp', new Date(now)] },
                    new Date(now),
                    { $add: ['$timestamp', 30 * 60000] }
                  ] },
                  { $max: ['$timestamp', start] }
                ] }] },
                3600000
              ] }
            ]
          }
        }
      }
    }
  ]);
  const fresh = totals.filter((r) => now - r.timestamp.getTime() <= 30 * 60000);
  const body = {
    district: req.params.districtId,
    currentTotalPowerKw: +fresh
      .reduce((sum, r) => sum + r.powerKw, 0)
      .toFixed(3),
    todayEstimatedEnergyKwh: +totals
      .reduce((sum, r) => sum + r.todayEnergyKwh, 0)
      .toFixed(3),
    energyMethod:
      'Time-weighted power: hold each sample until the next sample or now, capped at 30 minutes; clip intervals to the Asia/Colombo day. Gaps beyond 30 minutes contribute zero.',
    date: new Date(now + offset).toISOString().slice(0, 10),
    timezone: 'Asia/Colombo',
    activeInstallations: ids.length,
    reportingInstallations: fresh.length,
    staleAfterMinutes: 30
  };
  // Freshness and local-day boundaries change without database writes, so only
  // the representation ETag, not a database Last-Modified value, is appropriate.
  return send(req, res, body);
};
