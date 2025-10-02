/**
 * Test file to verify database connection and chat functionality
 * This file can be used for debugging and testing the database operations
 */

import { ensureDb } from "../../database/db";
import { ChatModel } from "../../database/models/chat";
import { ChatMessageModel } from "../../database/models/chat-message";
import { UserProfileModel } from "../../database/models/user-profile";

export async function testDatabaseConnection() {
  try {
    console.log("Testing database connection...");

    // Test database connection
    await ensureDb();
    console.log("✅ Database connected successfully");

    // Test user profile creation
    const testUser = await UserProfileModel.findOneAndUpdate(
      { userId: "test-user-123" },
      {
        $setOnInsert: {
          userId: "test-user-123",
          email: "test@example.com",
          name: "Test User",
          preferences: {},
        },
      },
      { upsert: true, new: true },
    );
    console.log("✅ User profile created/found:", testUser._id);

    // Test chat creation
    const testChat = new ChatModel({
      title: "Test Chat",
      userId: testUser._id,
      visibility: "private",
      lastContext: null,
    });
    const savedChat = await testChat.save();
    console.log("✅ Chat created:", savedChat._id);

    // Test message creation
    const testMessage = new ChatMessageModel({
      chatId: savedChat._id,
      role: "user",
      parts: [{ type: "text", text: "Hello, this is a test message!" }],
      attachments: [],
    });
    const savedMessage = await testMessage.save();
    console.log("✅ Message created:", savedMessage._id);

    // Test message retrieval
    const messages = await ChatMessageModel.find({ chatId: savedChat._id });
    console.log("✅ Messages retrieved:", messages.length);

    // Cleanup test data
    await ChatMessageModel.deleteMany({ chatId: savedChat._id });
    await ChatModel.deleteOne({ _id: savedChat._id });
    await UserProfileModel.deleteOne({ userId: "test-user-123" });
    console.log("✅ Test data cleaned up");

    console.log("🎉 All database tests passed!");
    return true;
  } catch (error) {
    console.error("❌ Database test failed:", error);
    return false;
  }
}

// Export for potential use in API routes or scripts
export default testDatabaseConnection;

