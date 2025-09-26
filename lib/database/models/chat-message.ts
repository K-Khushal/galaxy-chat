import { model, models, Schema, Types } from "mongoose";

export type ChatMessageRole = "system" | "user" | "assistant";

export interface IChatMessage {
    chatId: Types.ObjectId; // Ref to Chat document
    role: ChatMessageRole;
    parts: unknown[]; // Array of UIMessagePart JSON objects from AI SDK
    attachments: unknown[]; // Arbitrary attachment metadata
    createdAt: Date;
    updatedAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>(
    {
        chatId: { type: Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
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

// Optimize common queries: fetch messages by chat ordered by creation time
ChatMessageSchema.index({ chatId: 1, createdAt: 1 });

export const ChatMessageModel =
    models.ChatMessage || model<IChatMessage>("ChatMessage", ChatMessageSchema);


