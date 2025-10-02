import { connectMongoose } from "./mongoose";

let maintenancePerformed = false;

export async function ensureDb() {
  const connection = await connectMongoose();

  // Perform one-time database maintenance to fix index issues
  if (!maintenancePerformed) {
    try {
      await performMaintenanceIfNeeded();
      maintenancePerformed = true;
    } catch (error) {
      console.error("Database maintenance failed, but continuing:", error);
      // Don't fail the connection if maintenance fails
    }
  }

  return connection;
}

/**
 * Performs database maintenance to fix common issues like duplicate key errors
 */
async function performMaintenanceIfNeeded() {
  try {
    // Import here to avoid circular dependencies
    const { ChatModel } = await import("./models/chat");
    const { ChatMessageModel } = await import("./models/chat-message");

    // Check if problematic indexes exist and drop them
    const chatIndexes = await ChatModel.collection.getIndexes();
    if (chatIndexes.id_1) {
      console.log("Dropping problematic 'id' index from Chat collection...");
      await ChatModel.collection.dropIndex("id_1");
    }

    const messageIndexes = await ChatMessageModel.collection.getIndexes();
    if (messageIndexes.id_1) {
      console.log(
        "Dropping problematic 'id' index from ChatMessage collection...",
      );
      await ChatMessageModel.collection.dropIndex("id_1");
    }

    // Ensure proper indexes are in place
    await ChatModel.ensureIndexes();
    await ChatMessageModel.ensureIndexes();
  } catch (error) {
    // Log but don't throw - we don't want to break the app if maintenance fails
    console.warn("Database maintenance encountered an issue:", error.message);
  }
}
