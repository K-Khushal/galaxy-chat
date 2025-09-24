import mongoose from "mongoose";

declare global {
    // eslint-disable-next-line no-var
    var _mongooseConnection: {
        conn: typeof mongoose | null;
        promise: Promise<typeof mongoose> | null;
    } | undefined;
}

const globalCache = global._mongooseConnection || { conn: null, promise: null };
if (!global._mongooseConnection) {
    global._mongooseConnection = globalCache;
}

export async function connectMongoose() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("Missing MONGODB_URI in environment variables");
    }

    if (globalCache.conn) return globalCache.conn;

    if (!globalCache.promise) {
        // Recommended strict mode settings for Mongoose 8+
        mongoose.set("strictQuery", true);
        globalCache.promise = mongoose.connect(uri, {
            // Keep options minimal; Mongoose 8 uses modern defaults
            dbName: process.env.MONGODB_DB,
        });
    }

    globalCache.conn = await globalCache.promise;
    return globalCache.conn;
}

export type MongooseConnection = typeof mongoose;


