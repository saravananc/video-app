import { canCreateVideos, canManageBilling, FLAG_DENIED_MESSAGE, type FlagKey, type Role } from "@fav/core";
import { getDb, isFeatureEnabled } from "@fav/db";
import { getSession, type Session } from "./auth";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Session-backed tenancy context — org injected per request (FAV-204 AC). */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export async function requireVideoAccess(): Promise<Session> {
  const session = await requireSession();
  if (!canCreateVideos(session.role)) throw new ForbiddenError();
  return session;
}

/** Billing limited to owner/admin (FAV-203 AC). */
export async function requireBillingAccess(): Promise<Session> {
  const session = await requireSession();
  if (!canManageBilling(session.role)) throw new ForbiddenError("Billing requires admin or owner role");
  return session;
}

export function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export class FeatureDisabledError extends Error {
  constructor(public readonly flag: FlagKey) {
    super(FLAG_DENIED_MESSAGE[flag]);
    this.name = "FeatureDisabledError";
  }
}

/** Gate a route on a feature flag for the caller's org (FAV-1703). */
export async function requireFeature(orgId: string, flag: FlagKey): Promise<void> {
  if (!(await isFeatureEnabled(getDb(), flag, orgId))) {
    throw new FeatureDisabledError(flag);
  }
}

/** Uniform error responses for route handlers. */
export function authErrorResponse(err: unknown): { status: number; error: string } | null {
  if (err instanceof UnauthorizedError) return { status: 401, error: err.message };
  if (err instanceof ForbiddenError) return { status: 403, error: err.message };
  // 403 as well: authenticated and permitted, but the feature is off for this org.
  if (err instanceof FeatureDisabledError) return { status: 403, error: err.message };
  return null;
}
