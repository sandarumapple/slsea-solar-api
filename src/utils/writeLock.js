// Shared by management and ingestion. Serializes API writes in this process only.
let tail = Promise.resolve();
module.exports = async function withWriteLock(work) {
  const previous = tail;
  let release;
  tail = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
};
