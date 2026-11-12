const { MongoClient, logByte } = require("../provider/dependency.map");

const {
  MONGODB_URI,
  MONGO_CONFIG,
  DATABASE_NAME,
} = require("../provider/config.map");

if (!MONGODB_URI) throw logByte.error("MONGODB_URI is not defined");

if (!DATABASE_NAME) throw logByte.error("DATABASE_NAME is not defined");

const options = {
  ...MONGO_CONFIG,
};

let clientPromise;

async function connectAndVerify() {
  const client = new MongoClient(MONGODB_URI, options);

  try {
    await client.connect();

    const db = client.db(DATABASE_NAME);

    const adminInfo = await db.admin().command({
      hello: 1,
    });

    logByte.info("MongoDB connected successfully");

    logByte.info(`MongoDB server: ${adminInfo.msg || "Standard MongoDB"}`);

    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function connectWithRetry() {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await connectAndVerify();
    } catch (error) {
      lastError = error;
      logByte.error(`MongoDB connection attempt ${attempt} failed`);
    }
  }

  throw lastError;
}

function getMongoClient() {
  if (!clientPromise) {
    clientPromise = connectWithRetry().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }

  return clientPromise;
}

async function getDb() {
  const client = await getMongoClient();
  return client.db(DATABASE_NAME);
}

module.exports = { getMongoClient, getDb };
