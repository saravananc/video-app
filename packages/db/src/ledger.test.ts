import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "./client.js";
import { migrateTestDb } from "./migrate.js";
import { seed } from "./seed.js";
import {
  appendLedgerEntry,
  computeBalance,
  finalizeCredits,
  InsufficientCreditsError,
  refundCredits,
  reserveCredits
} from "./ledger.js";
import { jobs } from "./schema.js";

const ORG = "org_demo";

async function makeJob(db: Db, id: string) {
  await db.insert(jobs).values({
    id,
    orgId: ORG,
    kind: "generation",
    idempotencyKey: `test:${id}`
  });
}

describe("credit ledger (FAV-303 / FAV-904)", () => {
  let db: Db;
  let startingBalance: number;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
    startingBalance = await computeBalance(db, ORG);
    expect(startingBalance).toBeGreaterThan(0);
  });

  it("derives balance from the sum of entries", async () => {
    await appendLedgerEntry(db, { orgId: ORG, entryType: "grant", amount: 100, reason: "test" });
    expect(await computeBalance(db, ORG)).toBe(startingBalance + 100);
  });

  it("reserves credits and blocks overdraft (FAV-1205)", async () => {
    await makeJob(db, "job_1");
    const { reserved } = await reserveCredits(db, { orgId: ORG, jobId: "job_1", amount: 10 });
    expect(reserved).toBe(true);
    expect(await computeBalance(db, ORG)).toBe(startingBalance - 10);

    await makeJob(db, "job_2");
    await expect(
      reserveCredits(db, { orgId: ORG, jobId: "job_2", amount: startingBalance })
    ).rejects.toThrow(InsufficientCreditsError);
  });

  it("is idempotent: re-reserving the same job never double-charges (FAV-903)", async () => {
    await makeJob(db, "job_1");
    await reserveCredits(db, { orgId: ORG, jobId: "job_1", amount: 10 });
    await reserveCredits(db, { orgId: ORG, jobId: "job_1", amount: 10 });
    expect(await computeBalance(db, ORG)).toBe(startingBalance - 10);
  });

  it("finalize releases unused reserve", async () => {
    await makeJob(db, "job_1");
    await reserveCredits(db, { orgId: ORG, jobId: "job_1", amount: 20 });
    const { charged } = await finalizeCredits(db, { orgId: ORG, jobId: "job_1", actualCost: 15 });
    expect(charged).toBe(15);
    expect(await computeBalance(db, ORG)).toBe(startingBalance - 15);
  });

  it("refund fully compensates on terminal failure, exactly once (FAV-808)", async () => {
    await makeJob(db, "job_1");
    await reserveCredits(db, { orgId: ORG, jobId: "job_1", amount: 20 });
    const first = await refundCredits(db, { orgId: ORG, jobId: "job_1" });
    const second = await refundCredits(db, { orgId: ORG, jobId: "job_1" });
    expect(first.refunded).toBe(20);
    expect(second.refunded).toBe(20);
    expect(await computeBalance(db, ORG)).toBe(startingBalance);
  });

  it("seed is idempotent (FAV-305)", async () => {
    await seed(db);
    await seed(db);
    expect(await computeBalance(db, ORG)).toBe(startingBalance);
  });
});
