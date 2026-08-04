import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Which authentication scheme is active, so the sign-in page renders the right
 * thing instead of offering a password form that the API will reject (FAV-201).
 */
export async function GET() {
  const clerkActive = Boolean(process.env.CLERK_SECRET_KEY);
  return NextResponse.json({
    provider: clerkActive ? "clerk" : "local",
    signInUrl: clerkActive ? (process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? null) : null,
    signUpUrl: clerkActive ? (process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? null) : null
  });
}
