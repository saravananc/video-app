import { ForbiddenError, requireSession } from "./org";
import type { Session } from "./auth";

/** Staff gate for admin tooling (FAV-1701 AC: access restricted to staff). */
export async function requireStaff(): Promise<Session> {
  const session = await requireSession();
  if (!session.user.isStaff) throw new ForbiddenError("Staff only");
  return session;
}
