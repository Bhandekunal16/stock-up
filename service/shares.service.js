
const { getDb } = require("../database/mongodb");
const { DATABASE_COLLECTION } = require("../provider/config.map");

module.exports = class ShareService {
  #collectionCache;

  async collection() {
    if (this.#collectionCache) {
      return this.#collectionCache;
    }

    const db = await getDb();

    const collectionName = DATABASE_COLLECTION.shares;

    if (typeof collectionName !== "string") {
      throw new Error(
        `Invalid MongoDB collection name: ${JSON.stringify(collectionName)}`
      );
    }

    this.#collectionCache = db.collection(collectionName);

    return this.#collectionCache;
  }

  async storeData(data) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("Valid portfolio data is required");
    }

    const collection = await this.collection();

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    return collection.updateOne(
      { date: today },
      {
        $set: {
          data,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          date: today,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
};
