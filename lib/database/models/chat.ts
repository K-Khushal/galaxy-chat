import { model, models, Schema, type Types } from "mongoose";

export type ChatVisibility = "public" | "private";

export interface IChat {
  title: string;
  userId: Types.ObjectId; // Ref to UserProfile document
  visibility: ChatVisibility;
  lastContext: unknown | null; // AppUsage | null
  createdAt: Date;
  updatedAt: Date;
}

const ChatSchema = new Schema<IChat>(
  {
    title: { type: String, required: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
      index: true,
    },
    visibility: {
      type: String,
      enum: ["public", "private"],
      required: true,
      default: "private",
      index: true,
    },
    lastContext: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        // Only transform if _id exists to avoid null id values
        if (ret._id) {
          ret.id = ret._id.toString();
          delete ret._id;
        }
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        // Only transform if _id exists to avoid null id values
        if (ret._id) {
          ret.id = ret._id.toString();
          delete ret._id;
        }
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Common access patterns: list chats for a user ordered by recency
ChatSchema.index({ userId: 1, createdAt: -1 });

export const ChatModel = models.Chat || model<IChat>("Chat", ChatSchema);
