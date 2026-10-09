const models = require('../models');
const { ApiError, notFound } = require('../utils/errors');
const { conditional } = require('../utils/http');
const lock = require('../utils/writeLock');
const definitions = {
  provinces: { model: 'Province', parameter: 'provinceId', fields: ['name', 'code'], child: ['District', 'province'] },
  districts: { model: 'District', parameter: 'districtId', fields: ['name', 'province'], parent: ['province', 'Province'], child: ['GridSubstation', 'district'], populate: 'province' },
  substations: { model: 'GridSubstation', parameter: 'substationId', fields: ['name', 'code', 'district'], parent: ['district', 'District'], child: ['SolarInstallation', 'substation'], populate: { path: 'district', populate: 'province' } },
  installations: { model: 'SolarInstallation', parameter: 'installationId', fields: ['installationId', 'ownerName', 'meterId', 'inverterId', 'capacityKw', 'substation', 'active'], optional: ['inverterId'], parent: ['substation', 'GridSubstation'], child: ['GenerationReading', 'installation'], populate: { path: 'substation', populate: { path: 'district', populate: 'province' } } }
};
const invalid = message => new ApiError(400, 'VALIDATION_ERROR', message);
const conflict = message => new ApiError(409, 'RELATIONSHIP_CONFLICT', message);
function input(req, definition) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) throw invalid('A non-empty JSON object is required');
  for (const [key, value] of Object.entries(body)) {
    if (!definition.fields.includes(key)) throw invalid(`Unknown or protected field: ${key}`);
    if (key === 'active') { if (typeof value !== 'boolean') throw invalid('active must be boolean'); }
    else if (key === 'capacityKw') { if (!Number.isFinite(value) || value < 0.1) throw invalid('capacityKw must be a finite number of at least 0.1'); }
    else if (typeof value !== 'string' || !value.trim()) throw invalid(`${key} must be a non-empty string`);
    if (key === definition.parent?.[0] && !/^[a-f\d]{24}$/i.test(value)) throw invalid(`${key} must be a MongoDB ObjectId`);
  }
  if (req.method !== 'PATCH') {
    for (const key of definition.fields.filter(key => !(definition.optional || []).includes(key))) {
      // Creation retains the existing active=true default; PUT requires active explicitly.
      if (req.method === 'POST' && key === 'active') continue;
      if (!(key in body)) throw invalid(`${key} is required`);
    }
  }
  return body;
}
async function representation(definition, id) {
  let query = models[definition.model].findById(id);
  if (definition.populate) query = query.populate(definition.populate);
  const item = await query.lean();
  if (definition.model === 'SolarInstallation' && item) {
    const reading = await models.GenerationReading.findOne({ installation: id }).sort({ timestamp: -1, _id: -1 }).lean();
    item.lastKnownReading = reading ? { ...reading, status: reading.powerKw > 0 ? 'GENERATING' : 'IDLE' } : null;
  }
  return item;
}
async function dependencies(definition, id) {
  const scoped = await models.User.exists({ jurisdictionModel: definition.model, jurisdictionRef: id });
  const children = definition.child && await models[definition.child[0]].exists({ [definition.child[1]]: id });
  return Boolean(scoped || children);
}
exports.definitions = definitions;
exports.handler = resource => async (req, res) => lock(async () => {
  const definition = definitions[resource];
  const Model = models[definition.model];
  try {
    let item;
    if (req.method !== 'POST') {
      item = await Model.findById(req.params[definition.parameter]);
      if (!item) throw notFound(definition.model);
      // Use precisely the existing GET representation, including populated ancestors.
      const current = await representation(definition, item._id);
      if (conditional(req, res, current) && req.headers['if-none-match'] !== undefined)
        throw new ApiError(412, 'PRECONDITION_FAILED', 'If-None-Match matches the current representation');
    }
    if (req.method === 'DELETE') {
      if (await dependencies(definition, item._id)) throw conflict('Dependent children, readings or scoped accounts prevent deletion');
      await require('../utils/managementCache').changed();
      await item.deleteOne();
      res.removeHeader('ETag');
      res.removeHeader('Last-Modified');
      return res.status(204).end();
    }
    const body = input(req, definition);
    const candidate = item || new Model();
    for (const [key, value] of Object.entries(body)) candidate.set(key, value);
    if (req.method === 'PUT') for (const key of definition.optional || []) if (!(key in body)) candidate.set(key, undefined);
    await candidate.validate();
    if (definition.parent && !(await models[definition.parent[1]].exists({ _id: candidate[definition.parent[0]] }))) throw invalid('Parent resource does not exist');
    if (item) {
      const changed = key => candidate.isModified(key);
      if (definition.model === 'SolarInstallation') {
        if (['installationId', 'meterId', 'inverterId', 'substation'].some(changed) && await dependencies(definition, item._id)) throw conflict('Installation identity and parent are fixed while readings or device accounts exist');
      } else if (definition.parent && changed(definition.parent[0]) && await dependencies(definition, item._id)) {
        throw conflict('Parent cannot change while children or scoped accounts exist');
      }
    }
    if (!item || candidate.isModified()) {
      await require('../utils/managementCache').changed();
      await candidate.save();
    }
    const result = await representation(definition, candidate._id);
    // Response validators describe the new representation; request preconditions were checked above.
    conditional({ headers: {} }, res, result);
    if (req.method === 'POST') res.location(`/api/${resource}/${candidate._id}`).status(201);
    return res.json(result);
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'UNIQUENESS_CONFLICT', 'Resource violates a unique identifier or district name constraint');
    throw error;
  }
});
