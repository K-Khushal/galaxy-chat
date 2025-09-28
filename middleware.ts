import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isSignInRoute = createRouteMatcher(["/sign-in(.*)"]);
const isSignUpRoute = createRouteMatcher(["/sign-up(.*)"]);
const isForgotPasswordRoute = createRouteMatcher(["/forgot-password(.*)"]);
const isRootRoute = createRouteMatcher(["/"]);
const isChatRoute = createRouteMatcher(["/chat", "/chat/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, req.url));

  // Not logged in
  if (!userId) {
    // Allow public routes as-is
    if (
      isRootRoute(req) ||
      isSignInRoute(req) ||
      isSignUpRoute(req) ||
      isForgotPasswordRoute(req)
    ) {
      return;
    }
    // Protect chat routes
    if (isChatRoute(req)) {
      return redirectTo("/sign-in");
    }
    return;
  }

  // Logged in
  if (isSignInRoute(req) || isSignUpRoute(req)) {
    return redirectTo("/chat");
  }
  // All other routes proceed unchanged
  return;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
