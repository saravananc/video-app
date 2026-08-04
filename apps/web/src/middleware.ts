import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/billing", "/admin"];

/**
 * Route protection (FAV-204). Edge-safe: checks only for the presence of a
 * session cookie and redirects to sign-in. Full verification — HMAC for local
 * sessions, RS256 + JWKS for Clerk — happens in the Node runtime on every data
 * access via getSession(). API routes return 401 themselves.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Which cookie matters depends on who owns identity. NEXT_PUBLIC_ is used
  // because the secret key isn't available to edge middleware.
  const clerkActive = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const hasSession = clerkActive ? req.cookies.has("__session") : req.cookies.has("fav_session");
  if (hasSession) return NextResponse.next();

  // Clerk hosts its own sign-in page; local auth uses ours.
  const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
  if (clerkActive && signInUrl) {
    const target = new URL(signInUrl);
    target.searchParams.set("redirect_url", new URL(pathname, req.nextUrl.origin).toString());
    return NextResponse.redirect(target);
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/:path*", "/billing/:path*", "/admin/:path*"]
};
