import { MongoClient, ServerApiVersion } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

if (!uri) {
    throw new Error("Missing MONGODB_URI in environment variables");
}

if (!dbName) {
    throw new Error("Missing MONGODB_DB in environment variables");
}

declare global {
    // eslint-disable-next-line no-var
    var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
    if (!global._mongoClientPromise) {
        client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
        });
        global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise as Promise<MongoClient>;
} else {
    client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
    });
    clientPromise = client.connect();
}

export async function getDb() {
    const connectedClient = await clientPromise;
    return connectedClient.db(dbName);
}


