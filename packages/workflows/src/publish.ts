import { eq } from "drizzle-orm";
import { newId } from "@fav/core";
import { jobs, publishJobs, socialAccounts, videos, type Db } from "@fav/db";
import {
  decryptSecret,
  encryptSecret,
  getPublisherProvider,
  ReauthRequiredError,
  TransientPublishError,
  type OAuthTokens,
  type Platform,
  type PublisherProvider
} from "@fav/providers";
import type { PipelineDeps } from "./deps.js";

const MAX_ATTEMPTS = 3;
/** Refresh access tokens within this window of expiry (FAV-1305). */
const REFRESH_WINDOW_MS = 15 * 60 * 1000;

export async function createPublishJob(
  db: Db,
  args: {
    orgId: string;
    videoId: string;
    socialAccountId: string;
    platform: Platform;
    title: string;
    description?: string;
    tags?: string[];
    visibility?: "public" | "unlisted" | "private";
  }
): Promise<{ publishJobId: string }> {
  const publishJobId = newId("pub");
  await db.insert(publishJobs).values({
    id: publishJobId,
    orgId: args.orgId,
    videoId: args.videoId,
    socialAccountId: args.socialAccountId,
    platform: args.platform,
    title: args.title,
    description: args.description,
    tags: args.tags,
    visibility: args.visibility ?? "public",
    status: "pending"
  });
  // Publish work lives in publish_jobs, but the queue only claims from jobs —
  // so enqueue a pointer row that carries the publish job id (FAV-901/1306).
  await db.insert(jobs).values({
    id: newId("job"),
    orgId: args.orgId,
    videoId: args.videoId,
    kind: "publish",
    status: "queued",
    idempotencyKey: `publish:${publishJobId}`,
    detail: JSON.stringify({ publishJobId }),
    traceId: newId("trc")
  });
  return { publishJobId };
}

/** Decrypt, and refresh-if-expiring, an account's tokens; persists rotations (FAV-1305). */
export async function freshTokensFor(
  db: Db,
  account: typeof socialAccounts.$inferSelect,
  publisher: PublisherProvider
): Promise<OAuthTokens> {
  if (!account.accessTokenEncrypted) throw new ReauthRequiredError("No stored tokens");
  let tokens: OAuthTokens = {
    accessToken: decryptSecret(account.accessTokenEncrypted),
    refreshToken: account.refreshTokenEncrypted ? decryptSecret(account.refreshTokenEncrypted) : undefined,
    expiresAt: account.tokenExpiresAt?.getTime() ?? 0,
    scopes: account.scopes ?? []
  };

  if (tokens.expiresAt < Date.now() + REFRESH_WINDOW_MS) {
    if (!tokens.refreshToken) throw new ReauthRequiredError("Token expired with no refresh token");
    try {
      tokens = await publisher.refreshTokens(tokens.refreshToken);
      await db
        .update(socialAccounts)
        .set({
          accessTokenEncrypted: encryptSecret(tokens.accessToken),
          refreshTokenEncrypted: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
          tokenExpiresAt: new Date(tokens.expiresAt),
          status: "connected",
          updatedAt: new Date()
        })
        .where(eq(socialAccounts.id, account.id));
    } catch (err) {
      if (err instanceof ReauthRequiredError) {
        // Re-auth prompt on failure (FAV-1305 AC): surface in the accounts UI.
        await db
          .update(socialAccounts)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(socialAccounts.id, account.id));
      }
      throw err;
    }
  }
  return tokens;
}

/**
 * Publish a finished video to a connected account (FAV-1302/1306): token
 * refresh, upload with retry on transient errors, external post id recorded.
 */
export async function runPublishJob(deps: PipelineDeps, publishJobId: string): Promise<void> {
  const db = deps.db;
  const [job] = await db.select().from(publishJobs).where(eq(publishJobs.id, publishJobId));
  if (!job) throw new Error(`Publish job ${publishJobId} not found`);
  if (job.status === "published") return;

  const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, job.socialAccountId));
  const [video] = await db.select().from(videos).where(eq(videos.id, job.videoId));
  if (!account || !video?.finalAssetKey) {
    await db
      .update(publishJobs)
      .set({ status: "failed", error: "Missing account or final video", updatedAt: new Date() })
      .where(eq(publishJobs.id, publishJobId));
    throw new Error("Missing account or final video");
  }

  const publisher = getPublisherProvider(job.platform as Platform);
  const finalKey = video.finalAssetKey;

  for (let attempt = job.attempts; attempt < MAX_ATTEMPTS; attempt++) {
    await db
      .update(publishJobs)
      .set({ status: "uploading", attempts: attempt + 1, updatedAt: new Date() })
      .where(eq(publishJobs.id, publishJobId));
    try {
      const tokens = await freshTokensFor(db, account, publisher);
      const { externalPostId } = await publisher.upload({
        tokens,
        videoData: () => deps.storage.get(finalKey),
        metadata: {
          title: job.title,
          description: job.description ?? undefined,
          tags: job.tags ?? undefined,
          visibility: job.visibility as "public" | "unlisted" | "private",
          aiDisclosure: job.aiDisclosure
        }
      });
      await db
        .update(publishJobs)
        .set({ status: "published", externalPostId, publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(publishJobs.id, publishJobId));
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof TransientPublishError && attempt + 1 < MAX_ATTEMPTS;
      await db
        .update(publishJobs)
        .set({ status: retryable ? "retrying" : "failed", error: message, updatedAt: new Date() })
        .where(eq(publishJobs.id, publishJobId));
      if (!retryable) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/** Proactive token refresh sweep (FAV-1305): call from a scheduler or opportunistically. */
export async function refreshExpiringTokens(db: Db): Promise<{ refreshed: number; expired: number }> {
  const accounts = await db.select().from(socialAccounts).where(eq(socialAccounts.status, "connected"));
  let refreshed = 0;
  let expired = 0;
  const cutoff = Date.now() + REFRESH_WINDOW_MS;
  for (const account of accounts) {
    if (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() > cutoff) continue;
    try {
      await freshTokensFor(db, account, getPublisherProvider(account.platform as Platform));
      refreshed++;
    } catch {
      expired++;
    }
  }
  return { refreshed, expired };
}
