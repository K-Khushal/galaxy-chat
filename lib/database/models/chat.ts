import { model, models, Schema, Types } from "mongoose";

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
        userId: { type: Schema.Types.ObjectId, ref: "UserProfile", required: true, index: true },
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
            transform: (_doc: unknown, ret: any) => {
                ret.id = ret._id?.toString();
                delete ret._id;
                return ret;
            },
        },
        toObject: { virtuals: true },
    }
);

// Common access patterns: list chats for a user ordered by recency
ChatSchema.index({ userId: 1, createdAt: -1 });

export const ChatModel = models.Chat || model<IChat>("Chat", ChatSchema);


