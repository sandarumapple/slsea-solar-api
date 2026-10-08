require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const models = require('../src/models');

async function verify() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false });
  const minimums = { Province: 9, District: 25, GridSubstation: 20, SolarInstallation: 200, GenerationReading: 134600 };
  const counts = {};
  const issues = [];
  for (const [name, model] of Object.entries(models)) {
    counts[name] = await model.countDocuments();
    if (minimums[name] && counts[name] < minimums[name]) issues.push(`${name}: fewer than ${minimums[name]} records`);
  }
  for (const [child, parent, field] of [
    ['District', 'Province', 'province'],
    ['GridSubstation', 'District', 'district'],
    ['SolarInstallation', 'GridSubstation', 'substation'],
    ['GenerationReading', 'SolarInstallation', 'installation']
  ]) {
    const invalid = await models[child].aggregate([
      { $lookup: { from: models[parent].collection.name, localField: field, foreignField: '_id', as: 'parent' } },
      { $match: { 'parent.0': { $exists: false } } }, { $count: 'count' }
    ]);
    if (invalid.length) issues.push(`${child}: ${invalid[0].count} orphan references`);
  }
  const histories = await models.GenerationReading.aggregate([
    { $setWindowFields: { partitionBy: '$installation', sortBy: { timestamp: 1 }, output: {
      previous: { $shift: { output: '$timestamp', by: -1, default: null } }
    } } },
    { $group: {
      _id: '$installation', count: { $sum: 1 }, first: { $min: '$timestamp' }, last: { $max: '$timestamp' },
      maxGapMs: { $max: { $cond: ['$previous', { $subtract: ['$timestamp', '$previous'] }, 0] } }
    } }
  ]);
  const sufficient = histories.filter(h => h.count >= 673 && h.last - h.first >= 672 * 900000).length;
  if (sufficient < counts.SolarInstallation) issues.push('Some installations do not have a full week of 15-minute history');
  if (histories.some(h => h.maxGapMs > 900000)) issues.push('Some histories contain gaps longer than 15 minutes');
  const roles = await models.User.aggregate([{ $match: { active: true } }, { $group: { _id: '$role', count: { $sum: 1 } } }]);
  for (const role of ['ADMIN', 'PROVINCE_OFFICER', 'DISTRICT_OFFICER', 'DEVICE'])
    if (!roles.some(r => r._id === role)) issues.push(`Missing ${role} test account`);
  const accounts = await models.User.find().select('role jurisdictionType jurisdictionModel jurisdictionRef active').lean();
  const mapping = { ADMIN: ['NATIONAL', null], PROVINCE_OFFICER: ['PROVINCE', 'Province'], DISTRICT_OFFICER: ['DISTRICT', 'District'], SUBSTATION_OFFICER: ['SUBSTATION', 'GridSubstation'], DEVICE: ['INSTALLATION', 'SolarInstallation'] };
  let invalidAccounts = 0;
  const deviceIds = new Set();
  for (const account of accounts) {
    const expected = mapping[account.role];
    if (!expected || account.jurisdictionType !== expected[0]) { invalidAccounts++; continue; }
    if (expected[1]) {
      if (account.jurisdictionModel !== expected[1] || !account.jurisdictionRef || !await models[expected[1]].exists({ _id: account.jurisdictionRef })) invalidAccounts++;
      else if (account.role === 'DEVICE' && account.active) deviceIds.add(String(account.jurisdictionRef));
    } else if (account.jurisdictionRef || account.jurisdictionModel) invalidAccounts++;
  }
  if (invalidAccounts) issues.push(`${invalidAccounts} invalid account jurisdictions`);
  if (deviceIds.size < counts.SolarInstallation) issues.push('Some installations have no device account');
  console.log(JSON.stringify({ counts, installationsWithWeekOfHistory: sufficient, installationsWithDeviceAccount: deviceIds.size, issues, passed: issues.length === 0 }, null, 2));
  if (issues.length) process.exitCode = 1;
}
verify().catch(error => {
  // Never print connection strings, credentials or raw driver errors.
  console.error(`Database verification failed (${error.name}). Check connectivity, credentials and Atlas IP access.`);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
