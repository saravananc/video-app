/**
 * Tenancy context. Until Clerk/local-session auth lands (Phase C), every
 * request operates as the seeded demo org's owner.
 */
export async function getCurrentOrgContext(): Promise<{ orgId: string; userId: string }> {
  return { orgId: "org_demo", userId: "user_demo_owner" };
}
