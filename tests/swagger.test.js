const { test } = require('node:test');
const assert = require('node:assert/strict');
test('OpenAPI validates and covers every route and path parameter', async () => {
  const spec = require('../src/docs/swagger');
  await require('@apidevtools/swagger-parser').validate(
    JSON.parse(JSON.stringify(spec))
  );
  for (const layer of require('../src/routes').stack) {
    if (!layer.route || layer.route.methods._all) continue;
    const path = layer.route.path.replace(/:(\w+)/g, '{$1}');
    for (const method of Object.keys(layer.route.methods)) {
      const op = spec.paths[path]?.[method];
      assert.ok(op, `${method} ${path}`);
      for (const match of path.matchAll(/\{(\w+)\}/g))
        assert.ok(
          [
            ...(spec.paths[path].parameters || []),
            ...(op.parameters || [])
          ].some((p) => p.in === 'path' && p.required && p.name === match[1])
        );
    }
  }
});
