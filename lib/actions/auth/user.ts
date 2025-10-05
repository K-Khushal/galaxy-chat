import type { TypeUserProfile } from "@/lib/types";
import { ensureDb } from "../../database/db";
import {
  type IUserProfile,
  UserProfileModel,
} from "../../database/models/user-profile";

export type UserProfile = IUserProfile;

export async function createUser(
  params: TypeUserProfile,
): Promise<UserProfile> {
  await ensureDb();

  // First check if user already exists by userId or email
  const existingUser = await UserProfileModel.findOne({
    $or: [{ userId: params.userId }, { email: params.email }],
  })
    .lean<UserProfile>()
    .exec();

  if (existingUser) {
    return existingUser;
  }

  try {
    const userProfile = new UserProfileModel({
      userId: params.userId,
      email: params.email,
      name: params.name,
      imageUrl: params.imageUrl,
    });

    const result = await userProfile.save();
    return result.toObject();
  } catch (error: unknown) {
    // Handle MongoDB duplicate key error (code 11000)
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      // User was created by another request, fetch and return the existing user
      const existingUser = await UserProfileModel.findOne({
        $or: [{ userId: params.userId }, { email: params.email }],
      })
        .lean<UserProfile>()
        .exec();

      if (existingUser) {
        return existingUser;
      }
    }

    // Re-throw if it's not a duplicate key error or if we couldn't find the existing user
    throw error;
  }
}

export async function getUser(userId: string): Promise<UserProfile | null> {
  await ensureDb();

  const result = await UserProfileModel.findOne({ userId })
    .lean<UserProfile>()
    .exec();

  return result;
}

export async function updateUser(
  userId: string,
  updates: Partial<Omit<TypeUserProfile, "userId">>,
): Promise<UserProfile> {
  await ensureDb();

  const result = await UserProfileModel.findOneAndUpdate(
    { userId: userId },
    { $set: updates },
    { new: true, returnDocument: "after" },
  )
    .lean<UserProfile>()
    .exec();

  if (!result) {
    throw new Error("User not found");
  }

  return result;
}

export async function deleteUser(userId: string): Promise<void> {
  await ensureDb();

  const result = await UserProfileModel.findOneAndDelete({
    userId: userId,
  }).exec();

  if (!result) {
    throw new Error("User not found");
  }
}

// Keep the original function for backward compatibility
export async function getOrCreateUserProfile(
  params: TypeUserProfile,
): Promise<UserProfile> {
  // First try to get existing user
  const existingUser = await getUser(params.userId);

  if (existingUser) {
    return existingUser;
  }

  // If no existing user, try to create one
  // The createUser function now handles duplicates internally,
  // so this is safe even under concurrent requests
  try {
    return await createUser(params);
  } catch (error: unknown) {
    // If createUser fails for any reason other than duplicates,
    // try one more time to get the user (in case another request created it)
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      )
    ) {
      const user = await getUser(params.userId);
      if (user) {
        return user;
      }
    }

    // Re-throw the original error if we still can't find the user
    throw error;
  }
}
