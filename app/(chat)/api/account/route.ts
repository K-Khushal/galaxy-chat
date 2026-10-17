import { NextResponse } from "next/server";
import {
  deleteOwnedAccount,
  readOwnedProfile,
} from "@/lib/actions/account/account";
import { requireChatAccess } from "@/lib/auth/access";
import { errorResponse } from "@/lib/http/error-response";

export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const profile = await readOwnedProfile(access.userId);
    return NextResponse.json({ profile });
  } catch (error) {
    return errorResponse(error, "account_failed");
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const result = await deleteOwnedAccount(access.userId);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "account_failed");
  }
}
