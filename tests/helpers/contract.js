const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const assert = require('node:assert/strict');
const spec = require('../../src/docs/swagger');
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validators = new Map();
module.exports = function validateResponse(path, method, status, body) {
  const pathname = path.split('?')[0];
  const entry = Object.entries(spec.paths).find(([pattern]) =>
    new RegExp(`^${pattern.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(pathname));
  if (!entry) return; // Invalid/unmatched routes use the error middleware contract.
  const operation = entry[1][method.toLowerCase()];
  if (!operation) return;
  const response = operation.responses[status];
  assert.ok(response, `Undocumented ${status}: ${method} ${pathname}`);
  const schema = response.content?.['application/json']?.schema;
  if (!schema) return;
  const key = `${entry[0]}:${method}:${status}`;
  if (!validators.has(key)) validators.set(key, ajv.compile({ ...schema, components: spec.components }));
  const validate = validators.get(key);
  assert.ok(validate(body), `${method} ${pathname}: ${ajv.errorsText(validate.errors)}`);
};
