const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { User } = require('../src/models');
const base = { name: 'Test', email: 'test@example.invalid', passwordHash: 'not-a-real-hash' };
test('user validation rejects role/jurisdiction mismatches and missing scopes', async () => {
  for (const value of [
    { role: 'DEVICE', jurisdictionType: 'INSTALLATION' },
    { role: 'DISTRICT_OFFICER', jurisdictionType: 'NATIONAL' },
    { role: 'ADMIN', jurisdictionType: 'NATIONAL', jurisdictionRef: new mongoose.Types.ObjectId() },
    { role: 'DEVICE', jurisdictionType: 'INSTALLATION', jurisdictionRef: new mongoose.Types.ObjectId(), jurisdictionModel: 'District' }
  ]) await assert.rejects(new User({ ...base, ...value }).validate(), { name: 'ValidationError' });
});
test('valid national and scoped device accounts pass validation', async () => {
  await new User({ ...base, role: 'ADMIN', jurisdictionType: 'NATIONAL' }).validate();
  await new User({ ...base, role: 'DEVICE', jurisdictionType: 'INSTALLATION', jurisdictionRef: new mongoose.Types.ObjectId(), jurisdictionModel: 'SolarInstallation' }).validate();
});
