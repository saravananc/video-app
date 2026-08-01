import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/dashboard", "/billing", "/admin"];

/**
 * Route protection (FAV-204). Edge-safe: checks session-cookie presence and
 * redirects to /login; full cryptographic verification happens in the Node
 * runtime (getSession) on every data access. API routes 401 themselves.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const hasSession = req.cookies.has("fav_session");
  if (!hasSession) {
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/billing/:path*", "/admin/:path*"]
};
