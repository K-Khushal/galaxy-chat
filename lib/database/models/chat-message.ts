import type { ChatMessageRole } from "@/lib/types";
import { type Document, model, models, Schema } from "mongoose";
import { v4 as uuidv4 } from "uuid";

export interface IChatMessage extends Document {
  id: string;
  chatId: string; // Ref to Chat document
  role: ChatMessageRole;
  parts: unknown[]; // Array of UIMessagePart JSON objects from AI SDK
  attachments: unknown[]; // Arbitrary attachment metadata
  createdAt: Date;
  updatedAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => uuidv4(),
    },
    chatId: {
      type: String,
      required: true,
      index: true,
      ref: "Chat",
    },
    role: {
      type: String,
      required: true,
      enum: ["system", "user", "assistant"],
    },
    parts: {
      type: [Schema.Types.Mixed],
      required: true,
      default: [],
      // Store structured UIMessagePart objects as-is
    },
    attachments: {
      type: [Schema.Types.Mixed],
      required: true,
      default: [],
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  },
);

// Optimize common queries: fetch messages by chat ordered by creation time
ChatMessageSchema.index({ chatId: 1, createdAt: 1 });

export const ChatMessageModel =
  models.ChatMessage || model<IChatMessage>("ChatMessage", ChatMessageSchema);
