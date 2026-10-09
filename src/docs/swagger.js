const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const array = (name) => ({ type: 'array', items: ref(name) });
const id = {
  type: 'string',
  pattern: '^[a-fA-F0-9]{24}$',
  example: '507f1f77bcf86cd799439011'
};
const date = { type: 'string', format: 'date-time' };
const number = { type: 'number' };
const string = { type: 'string' };
const timestamps = { _id: id, createdAt: date, updatedAt: date };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', required, properties });
const headers = {
  ETag: {
    description: 'Representation validator; send in If-None-Match.',
    schema: string
  },
  'Last-Modified': {
    description: 'Available when a database modification time exists.',
    schema: string
  },
  'Cache-Control': {
    description: 'Private, revalidated responses.',
    schema: string
  }
};
const response = (description, schema, extra = {}) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema } } } : {}),
  ...extra
});
const error = (description) => response(description, ref('Error'));
const errors = {
  400: error('Invalid identifier, query or body'),
  401: { ...error('Missing, expired or invalid authentication'), headers: { 'WWW-Authenticate': { schema: string } } },
  403: error('Wrong role or outside jurisdiction'),
  404: error('Resource not found'),
  405: { ...error('Unsupported method; readings are append-only'), headers: { Allow: { schema: string } } },
  406: error('Accept does not allow JSON'),
  412: error('A supplied HTTP precondition did not match'),
  500: error('Unexpected server error')
};
const query = (name, schema, description) => ({
  name,
  in: 'query',
  schema,
  description
});
const historyParameters = [
  query('page', { type: 'integer', minimum: 1, default: 1 }, 'One-based page.'),
  query(
    'pageSize',
    { type: 'integer', minimum: 1, default: 20 },
    'Capped at 100.'
  ),
  query('from', date, 'Inclusive lower timestamp bound; timezone required.'),
  query('to', date, 'Inclusive upper timestamp bound; timezone required.'),
  query(
    'order',
    { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
    'Timestamp order, with ID as a stable tie-breaker.'
  )
];
const conditionalParameters = ['If-None-Match', 'If-Modified-Since', 'If-Match', 'If-Unmodified-Since'].map(
  (name) => ({
    name,
    in: 'header',
    schema: string,
    description:
      name === 'If-None-Match'
        ? 'ETag or comma-separated ETags; takes precedence over the date validator.'
        : name === 'If-Match'
          ? 'Strong ETag precondition; a mismatch returns 412.'
          : name === 'If-Unmodified-Since'
            ? 'HTTP date precondition; ignored when If-Match is supplied.'
            : 'HTTP date from Last-Modified, when supplied.'
  })
);
const paths = {};
function get(path, summary, schema, parameters = [], description = '') {
  paths[path] = {
    parameters: [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: id
    })),
    get: {
      summary,
      description,
      tags: ['Read resources'],
      parameters: [...parameters, ...conditionalParameters],
      responses: {
        200: response('Successful JSON representation', schema, { headers }),
        304: response('Unchanged representation; empty body', null, {
          headers
        }),
        ...errors
      }
    }
  };
}
get('/me', 'Identify my account and assigned jurisdiction without an ID', ref('ReaderContext'), [],
  'Reader only. The verified JWT subject identifies the current active database account. Returns that account’s assigned province/district/substation with ancestor context and links to scope-derived collections. NATIONAL has resource=null. No query parameters; cannot override scope. Devices are denied.');
get('/provinces', 'List visible provinces', array('Province'));
get('/districts', 'List my permitted districts without a province ID', array('District'), [],
  'Derives allowed districts from the current authenticated account. National readers see all districts; province readers see their province; district/substation readers see their permitted district. No query parameters.');
get('/substations', 'List my permitted substations without a district ID', array('Substation'), [],
  'Derives allowed substations from the current authenticated account. No query parameters.');
get('/installations', 'List my permitted installations without a substation ID', array('Installation'), [],
  'Lists installations within the current reader’s allowed substations, with populated ancestry. No query parameters.');
get('/provinces/{provinceId}', 'Retrieve a visible province', ref('Province'));
get(
  '/provinces/{provinceId}/districts',
  'List permitted districts within a province',
  array('District')
);
get('/districts/{districtId}', 'Retrieve a visible district', ref('District'));
get(
  '/districts/{districtId}/substations',
  'List permitted substations within a district',
  array('Substation')
);
get(
  '/districts/{districtId}/generation-summary',
  'District operational summary and estimated daily energy',
  ref('Summary'),
  [],
  'Restricted to the reader’s permitted substations. Latest readings older than 30 minutes contribute no current power. Daily energy integrates each power sample until the next sample or now, capped at 30 minutes and clipped to the Asia/Colombo day. Longer gaps contribute zero; the result remains an estimate. Uses ETag only because day and freshness boundaries change without writes.'
);
get(
  '/substations/{substationId}',
  'Retrieve a visible substation',
  ref('Substation')
);
get(
  '/substations/{substationId}/installations',
  'List installations in a visible substation',
  array('Installation')
);
get(
  '/installations/{installationId}',
  'Installation, geographic hierarchy and latest reading',
  ref('InstallationComposite')
);
get(
  '/installations/{installationId}/last-reading',
  'Derived latest reading and generation status',
  ref('LastReading'),
  [],
  'Status describes the latest sample, not a guarantee of live connectivity. Compute sample age from timestamp.'
);
get(
  '/installations/{installationId}/readings',
  'Paginated installation history',
  ref('History'),
  historyParameters
);
get(
  '/installations/{installationId}/readings/{readingId}',
  'Retrieve a reading belonging to this installation',
  ref('Reading')
);
get(
  '/readings',
  'History filtered by jurisdiction and time',
  ref('History'),
  [
    ...historyParameters,
    ...['provinceId', 'districtId', 'substationId'].map((name) =>
      query(
        name,
        id,
        'Optional geographic filter intersected with the authenticated scope.'
      )
    )
  ],
  'Without filters returns all history visible to this reader. Outside-scope filters return 403. Unknown parameters return 400.'
);
paths['/installations/{installationId}/readings'].post = {
  tags: ['Device ingestion'],
  summary: 'Append a reading from the assigned device',
  description:
    'DEVICE only, assigned active installation only. Immutable samples; PUT, PATCH and DELETE return 405. Duplicate installation/timestamp returns 409. Location is retrievable by an authorized SLSEA reader; devices remain write-only.',
  requestBody: {
    required: true,
    content: { 'application/json': { schema: ref('ReadingInput') } }
  },
  responses: {
    ...Object.fromEntries(Object.entries(errors).filter(([status]) => status !== '412')),
    201: response('Reading created', ref('Reading'), {
      headers: {
        Location: { description: 'Individual reading URI.', schema: string }
      }
    }),
    409: error('Duplicate installation timestamp'),
    413: error('Body exceeds 100 KB'),
    415: error('Content-Type must be application/json')
  }
};
paths['/auth/login'] = {
  post: {
    tags: ['Authentication'],
    security: [],
    summary: 'Authenticate a reader or device',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string', format: 'password' }
            }
          }
        }
      }
    },
    responses: {
      200: response('Signed bearer token; no-store', ref('Login')),
      400: errors[400],
      401: errors[401],
      429: { ...error('Too many login attempts'), headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds before retrying.' } } },
      406: errors[406],
      413: error('Body exceeds 100 KB'),
      415: error('Content-Type must be application/json'),
      500: errors[500]
    }
  }
};
paths['/'] = {
  get: {
    security: [],
    summary: 'API entry point',
    responses: {
      200: response(
        'API links',
        object({
          name: string,
          documentation: string,
          authentication: string,
          resources: { type: 'array', items: string }
        })
      )
    }
  }
};
const readingFields = {
  installation: id,
  timestamp: date,
  powerKw: {
    type: 'number',
    minimum: 0,
    description: 'At most 120% of installation capacity.'
  },
  cumulativeEnergyKwh: { type: 'number', minimum: 0 },
  voltage: { type: 'number', minimum: 100, maximum: 500 }
};
const { installation, ...inputFields } = readingFields;
module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'SLSEA Real-Time Solar Generation API',
    version: require('../../package.json').version,
    description:
      'Login using POST /auth/login, copy token, and use the Authorize button (token only). Leave conditional headers empty for a first request. Backend-only solar API. SLSEA readers are jurisdiction-scoped; metering devices can only append readings for their own installation. JSON representations, immutable readings, relative pagination links, private conditional GET. Health: /health. Machine-readable specification: /api/openapi.json.'
  },
  servers: [{ url: '/api' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'First POST /auth/login, then paste only the returned token here. Do not put the token in If-None-Match.' }
    },
    schemas: {
      ReaderContext: object({
        user: object({ id, name: string, role: string, jurisdictionType: string }),
        jurisdiction: object({
          type: { type: 'string', enum: ['NATIONAL', 'PROVINCE', 'DISTRICT', 'SUBSTATION'] },
          resource: {
            type: 'object', nullable: true,
            description: 'Assigned geographic entity with its ancestors; null for NATIONAL. Never a User document.',
            required: ['_id', 'name', 'createdAt', 'updatedAt'],
            properties: { ...timestamps, name: string }
          }
        }),
        links: object({ self: string, provinces: string, districts: string,
          substations: string, installations: string, readings: string })
      }),
      Error: {
        type: 'object',
        required: ['code', 'message', 'detail'],
        properties: { code: string, message: string, detail: string }
      },
      Province: object({ ...timestamps, name: string, code: string }),
      District: object({
        ...timestamps,
        name: string,
        province: { oneOf: [id, ref('Province')] }
      }),
      Substation: object({
        ...timestamps,
        name: string,
        code: string,
        district: { oneOf: [id, ref('District')] }
      }),
      Installation: object({
        ...timestamps,
        installationId: string,
        ownerName: string,
        meterId: string,
        inverterId: string,
        capacityKw: number,
        active: { type: 'boolean' },
        substation: { oneOf: [id, ref('Substation')] }
      }, ['_id', 'createdAt', 'updatedAt', 'installationId', 'ownerName', 'meterId', 'capacityKw', 'active', 'substation']),
      InstallationComposite: {
        allOf: [
          ref('Installation'),
          object({
            lastKnownReading: {
              type: 'object',
              nullable: true,
              required: ['_id', 'createdAt', ...Object.keys(readingFields), 'status'],
              properties: { _id: id, createdAt: date, ...readingFields, status: { type: 'string', enum: ['GENERATING', 'IDLE'] } }
            }
          })
        ]
      },
      ReadingInput: {
        type: 'object',
        required: Object.keys(inputFields),
        properties: inputFields,
        description:
          'Timestamp requires a timezone and must be no more than five minutes in the future. Numeric fields must be finite.'
      },
      Reading: object({ _id: id, createdAt: date, ...readingFields }),
      LastReading: {
        allOf: [
          ref('Reading'),
          object({ status: { type: 'string', enum: ['GENERATING', 'IDLE'] } })
        ]
      },
      History: object({
        data: array('Reading'),
        pagination: object({
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          totalCount: { type: 'integer' },
          totalPages: { type: 'integer' }
        }),
        links: object({
          self: string,
          next: { type: 'string', nullable: true },
          previous: { type: 'string', nullable: true }
        })
      }),
      Summary: object({
        district: id,
        currentTotalPowerKw: number,
        todayEstimatedEnergyKwh: number,
        energyMethod: string,
        date: { type: 'string', format: 'date' },
        timezone: string,
        activeInstallations: { type: 'integer' },
        reportingInstallations: { type: 'integer' },
        staleAfterMinutes: { type: 'integer' }
      }),
      Login: object({
        token: string,
        tokenType: { type: 'string', enum: ['Bearer'] },
        expiresIn: string,
        user: object({
          id,
          name: string,
          role: string,
          jurisdictionType: string
        })
      })
    }
  },
  paths
};

// Supporting surfaces use an origin-relative server rather than the /api base.
paths['/health'] = {
  servers: [{ url: '/' }],
  get: {
    security: [], summary: 'Database connection-state readiness',
    responses: {
      200: response('Connected', object({ status: { type: 'string', enum: ['ok'] }, database: { type: 'string', enum: ['connected'] } })),
      503: response('Disconnected', object({ status: { type: 'string', enum: ['unavailable'] }, database: { type: 'string', enum: ['disconnected'] } }))
    }
  }
};
paths['/openapi.json'] = { get: { security: [], summary: 'OpenAPI document', responses: { 200: response('OpenAPI 3.0.3 specification', { type: 'object', required: ['openapi', 'info', 'paths'] }) } } };
paths['/docs/'] = { get: { security: [], summary: 'Swagger UI', responses: { 200: { description: 'Interactive documentation', content: { 'text/html': { schema: string } } } } } };
const summaryOperation = paths['/districts/{districtId}/generation-summary'].get;
summaryOperation.parameters = conditionalParameters.filter(p => ['If-Match', 'If-None-Match'].includes(p.name));
for (const code of [200, 304]) {
  summaryOperation.responses[code].headers = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'Last-Modified'));
}
module.exports.components.schemas.ReadingInput.example = {
  timestamp: '2026-10-06T10:00:00+05:30', powerKw: 2.5, cumulativeEnergyKwh: 1200.5, voltage: 230
};
module.exports.components.schemas.Error.example = {
  code: 'FORBIDDEN', message: 'Outside your jurisdiction', detail: 'Outside your jurisdiction'
};

// Management is an explicit extension; ADMIN remains a national reader.
for (const [resource, definition] of Object.entries(require('../controllers/managementController').definitions)) {
  const schemaName = { provinces: 'Province', districts: 'District', substations: 'Substation', installations: 'InstallationComposite' }[resource];
  const properties = Object.fromEntries(definition.fields.map(field => [field,
    field === 'active' ? { type: 'boolean' } : field === 'capacityKw' ? { type: 'number', minimum: 0.1 } : field === definition.parent?.[0] ? id : { type: 'string', minLength: 1 }
  ]));
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const path = method === 'post' ? `/${resource}` : `/${resource}/{${definition.parameter}}`;
    const input = { type: 'object', additionalProperties: false, properties, minProperties: 1 };
    if (method !== 'patch') input.required = definition.fields.filter(field => !(definition.optional || []).includes(field) && !(method === 'post' && field === 'active'));
    paths[path][method] = {
      tags: ['Management'], summary: `${method.toUpperCase()} ${resource}`,
      description: 'SYSTEM_ADMIN only. JSON object PATCH updates supplied fields (not JSON Patch or Merge Patch; null is rejected). PUT replaces all editable fields; omitted inverterId is removed. Parent references must exist. Deletion conflicts with children/readings/scoped accounts. District/substation parent changes conflict with children or scoped accounts. Installation identity (installationId, meterId, inverterId) and parent changes conflict with readings or device accounts. PATCH active=false deactivates without erasing history. Repeated DELETE returns 404. Writes and ingestion are serialized within one API process only; multiple processes/direct database writers require external coordination.',
      parameters: method === 'post' ? [] : conditionalParameters.filter(p => ['If-Match', 'If-Unmodified-Since', 'If-None-Match'].includes(p.name)),
      ...(method === 'delete' ? {} : { requestBody: { required: true, content: { 'application/json': { schema: input } } } }),
      responses: {
        [method === 'post' ? 201 : method === 'delete' ? 204 : 200]: response(method === 'delete' ? 'Deleted; empty body' : 'Current GET representation', method === 'delete' ? null : ref(schemaName), { headers: { ...headers, ...(method === 'post' ? { Location: { schema: string } } : {}) } }),
        ...errors, 409: error('Unique constraint or relationship/history conflict'), 415: error('application/json required')
      }
    };
  }
}
