import { model, models, Schema } from "mongoose";

export interface IUserProfile {
  userId: string;
  email?: string;
  name?: string;
  imageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserProfileSchema = new Schema<IUserProfile>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true },
    name: { type: String },
    imageUrl: { type: String },
  },
  { timestamps: true },
);

export const UserProfileModel =
  models.UserProfile || model<IUserProfile>("UserProfile", UserProfileSchema);
