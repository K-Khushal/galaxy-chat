import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { type Access, requireAccess } from "@/lib/auth/access";
import { AppError } from "@/lib/errors";

/**
 * Page-level auth gate: returns the invited user, or redirects to /sign-in.
 * Layouts do not re-render on client navigation, so data access behind the
 * gate must still call `requireAccess` itself.
 */
export async function requireSignedIn(): Promise<Access> {
  return requireAccess(await headers()).catch((error) => {
    if (error instanceof AppError && error.status < 500) {
      redirect(
        error.id === "invite_required"
          ? "/sign-in?notice=invite_required"
          : "/sign-in",
      );
    }
    throw error;
  });
}
