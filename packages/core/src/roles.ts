/** Role model (FAV-203): owner > admin > member, enforced server-side. */

export type Role = "owner" | "admin" | "member";

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Billing limited to owner/admin (FAV-203 AC). */
export function canManageBilling(role: Role): boolean {
  return roleAtLeast(role, "admin");
}

/** Only owners change roles or delete the org. */
export function canManageOrg(role: Role): boolean {
  return roleAtLeast(role, "owner");
}

/** Any member can create and manage videos. */
export function canCreateVideos(role: Role): boolean {
  return roleAtLeast(role, "member");
}

/** Admins and owners can invite teammates (FAV-205). */
export function canInvite(role: Role): boolean {
  return roleAtLeast(role, "admin");
}
