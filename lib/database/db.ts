import { connectMongoose } from "./mongoose";

export async function ensureDb() {
    return connectMongoose();
}


