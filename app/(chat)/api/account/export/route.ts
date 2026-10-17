import { exportOwnedAccount } from "@/lib/actions/account/account";
import { requireChatAccess } from "@/lib/auth/access";
import { errorResponse } from "@/lib/http/error-response";

export async function GET(request: Request) {
  try {
    const access = await requireChatAccess(request.headers);
    const exported = await exportOwnedAccount(access.userId);
    return Response.json(exported);
  } catch (error) {
    return errorResponse(error, "account_export_failed");
  }
}
