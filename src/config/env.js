function validateEnvironment({ requireDatabase = false } = {}) {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || /YOUR_|replace-with/i.test(secret))
    throw new Error(
      'Set JWT_SECRET to a random value of at least 32 characters in .env.'
    );
  const uri = process.env.MONGODB_URI || '';
  if (
    uri &&
    (/YOUR_|<[^>]+>/i.test(uri) || !/^mongodb(?:\+srv)?:\/\//.test(uri))
  )
    throw new Error(
      'Replace MONGODB_URI with your real MongoDB connection string in .env.'
    );
  if ((requireDatabase || process.env.NODE_ENV === 'production') && !uri)
    throw new Error(
      'Set MONGODB_URI to a persistent database before seeding or running in production.'
    );
}
module.exports = validateEnvironment;
