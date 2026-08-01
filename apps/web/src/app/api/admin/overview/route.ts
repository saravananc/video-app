import { NextRequest, NextResponse } from "next/server";
import { desc, ilike, or, sql } from "drizzle-orm";
import { getDb, memberships, organizations, users } from "@fav/db";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** Admin overview (FAV-1701): search users/orgs, view balances. */
export async function GET(req: NextRequest) {
  try {
    await requireStaff();
    const db = getDb();
    const q = req.nextUrl.searchParams.get("q")?.trim();

    const orgRows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        plan: organizations.plan,
        cachedBalance: organizations.cachedBalance,
        createdAt: organizations.createdAt,
        memberCount: sql<number>`(select count(*) from ${memberships} where ${memberships.orgId} = ${organizations.id})::int`
      })
      .from(organizations)
      .where(q ? or(ilike(organizations.name, `%${q}%`), ilike(organizations.id, `%${q}%`)) : undefined)
      .orderBy(desc(organizations.createdAt))
      .limit(50);

    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isStaff: users.isStaff,
        createdAt: users.createdAt
      })
      .from(users)
      .where(q ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`)) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(50);

    return NextResponse.json({ orgs: orgRows, users: userRows });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
