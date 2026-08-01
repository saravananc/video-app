import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

/** Sign-out clears the session (FAV-201 AC). */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
