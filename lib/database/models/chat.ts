import type { AppUsage } from "@/lib/ai/usage";
import { model, models, Schema } from "mongoose";
import { v4 as uuidv4 } from "uuid";

export type ChatVisibility = "public" | "private";

export interface IChat extends Document {
  id: string;
  title: string;
  userId: string;
  visibility: ChatVisibility;
  lastContext: AppUsage | null;
  createdAt: Date;
  updatedAt: Date;
}

const ChatSchema = new Schema<IChat>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => uuidv4(),
    },
    title: { type: String, required: true },
    userId: {
      type: String,
      required: true,
      index: true,
      ref: "UserProfile",
    },
    visibility: {
      type: String,
      enum: ["public", "private"],
      required: true,
      default: "private",
      index: true,
    },
    lastContext: { type: Schema.Types.Mixed, default: null }, // AppUsage
  },
  {
    timestamps: true,
  },
);

// Common access patterns: list chats for a user ordered by recency
ChatSchema.index({ userId: 1, createdAt: -1 });

export const ChatModel = models.Chat || model<IChat>("Chat", ChatSchema);
