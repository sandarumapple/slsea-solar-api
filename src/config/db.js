const mongoose = require('mongoose');

async function connectDb() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`MongoDB connected: ${mongoose.connection.host}`);
    return;
  }
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('solar_generation'));
  console.log(
    'MongoDB running in ephemeral in-memory mode (data clears when the API stops)'
  );
}
module.exports = connectDb;
