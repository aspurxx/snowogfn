// Tilted: bring players from an older/separate MongoDB into the shared account store in
// %LOCALAPPDATA%\ProjectTilted\UserData (the database the launcher uses).
// Insert-only: a player is copied only when neither its account ID nor its name, email
// or login ID already exists in the shared store. Nothing is ever deleted or overwritten
// in either database. Set LEGACY_MONGO_URI in .env to enable it.
import mongoose from "mongoose";
import User from "../User/Mongodb/Schema/user.js";
import Profile from "../User/Mongodb/Schema/profiles.js";
import Friends from "../User/Mongodb/Schema/friends.js";

export async function importLegacyAccounts() {
  const uri = (process.env.LEGACY_MONGO_URI || "").trim();
  if (!uri || uri === (process.env.MONGO_URI || "").trim()) return 0;
  let connection;
  try {
    connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 3000 }).asPromise();
  } catch {
    return 0; // the old database is not running; nothing to import
  }
  let imported = 0;
  try {
    const source = connection.db;
    const users = await source.collection(User.collection.collectionName).find({}).toArray();
    // Players deleted in the launcher stay deleted (they used to come back on every launch).
    const deleted = new Set((await User.db.collection('tilted_deleted_players').find({}).toArray()).map((d) => d.accountId));
    for (const user of users) {
      if (!user.accountId || user.travelGuest || deleted.has(user.accountId)) continue;
      const clash = await User.collection.findOne({
        $or: [
          { accountId: user.accountId },
          { username_lower: user.username_lower },
          { email: user.email },
          { discordId: user.discordId },
        ],
      });
      if (clash) continue;
      const profile = await source.collection(Profile.collection.collectionName).findOne({ accountId: user.accountId });
      if (!profile) continue;
      const friends = await source.collection(Friends.collection.collectionName).findOne({ accountId: user.accountId });
      const { _id: _u, ...userDoc } = user;
      const { _id: _p, ...profileDoc } = profile;
      await Profile.collection.insertOne(profileDoc);
      await User.collection.insertOne(userDoc);
      if (friends) {
        const { _id: _f, ...friendsDoc } = friends;
        await Friends.collection.updateOne({ accountId: user.accountId }, { $setOnInsert: friendsDoc }, { upsert: true });
      }
      imported++;
    }
    if (imported) console.log(`[Tilted] Imported ${imported} player(s) from the previous database.`);
  } finally {
    await connection.close().catch(() => {});
  }
  return imported;
}
