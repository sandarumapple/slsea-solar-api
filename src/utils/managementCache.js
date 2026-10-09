const mongoose = require('mongoose');
const { latestModification } = require('./http');
// A persisted deletion clock prevents date-only validators from hiding removed rows.
const Revision = mongoose.model('ManagementCacheRevision', new mongoose.Schema({
  _id: String, modified: Date
}));
exports.changed = () => Revision.updateOne({ _id: 'management' }, { $set: { modified: new Date() } }, { upsert: true });
exports.modified = async value => {
  const revision = await Revision.findById('management').lean();
  return Math.max(latestModification(value), revision?.modified?.getTime() || 0);
};
