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
        `Invalid MongoDB collection name: ${JSON.stringify(collectionName)}`,
      );
    }

    this.#collectionCache = db.collection(collectionName);

    return this.#collectionCache;
  }

  async getStoreData(date) {
    try {
      const collection = await this.collection();

      const filter = {};

      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new Error("Invalid date format. Expected YYYY-MM-DD");
        }

        filter.date = date;
      }

      return await collection.find(filter).sort({ date: -1 }).toArray();
    } catch (error) {
      console.error("Failed to retrieve portfolio data:", error);
      throw error;
    }
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
      { upsert: true },
    );
  }
};
