import { NextRequest, NextResponse } from "next/server";
import { eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@fav/core";
import { getDb, users, voices } from "@fav/db";
import { assetKeys, encryptSecret, getStorageProvider, getTtsProvider, MockTtsProvider } from "@fav/providers";
import { authErrorResponse, requireSession, requireVideoAccess } from "@/lib/org";

export const dynamic = "force-dynamic";

/** Voice library + org clones with previews (FAV-602/1106). */
export async function GET() {
  try {
    const session = await requireSession();
    const db = getDb();
    const storage = getStorageProvider();
    const rows = await db
      .select()
      .from(voices)
      .where(or(isNull(voices.orgId), eq(voices.orgId, session.orgId)));

    const withPreviews = await Promise.all(
      rows.map(async (v) => {
        // Previews synthesize on first request so the library is audible keyless.
        const previewKey = v.previewAssetKey ?? assetKeys.voicePreview(v.id);
        if (!(await storage.exists(previewKey))) {
          const tts = new MockTtsProvider();
          const sample = await tts.synthesize({
            text: `Hi, I'm ${v.name}. ${v.description ?? "This is how I sound."}`,
            voiceId: v.providerVoiceId,
            language: v.language
          });
          await storage.put(previewKey, sample.audio, sample.contentType);
        }
        return {
          id: v.id,
          name: v.name,
          description: v.description,
          language: v.language,
          gender: v.gender,
          isClone: v.isClone,
          status: v.status,
          previewUrl: await storage.getSignedUrl(previewKey, 3600)
        };
      })
    );
    const [user] = await db
      .select({ defaultVoiceId: users.defaultVoiceId })
      .from(users)
      .where(eq(users.id, session.userId));
    return NextResponse.json({ voices: withPreviews, defaultVoiceId: user?.defaultVoiceId ?? null });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

const cloneSchema = z.object({
  name: z.string().min(1).max(60),
  /** Base64 WAV sample; the demo UI sends a generated sample when no mic is available. */
  sampleBase64: z.string().min(100)
});

/** Voice cloning (FAV-603): sample stored encrypted, clone scoped to the org. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireVideoAccess();
    const parsed = cloneSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const sample = Buffer.from(parsed.data.sampleBase64, "base64");
    if (sample.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Sample too large (10MB max)" }, { status: 400 });
    }

    const tts = getTtsProvider();
    const { providerVoiceId } = await tts.cloneVoice({ name: parsed.data.name, sample });

    const voiceId = newId("voice");
    const storage = getStorageProvider();
    const sampleKey = assetKeys.voiceCloneSample(voiceId);
    await storage.put(sampleKey, sample, "audio/wav");

    const db = getDb();
    await db.insert(voices).values({
      id: voiceId,
      orgId: session.orgId,
      provider: tts.name,
      providerVoiceId,
      name: parsed.data.name,
      description: "Cloned voice",
      language: "en",
      isClone: true,
      // Sample reference encrypted at rest (FAV-1603/603 AC).
      cloneSampleKeyEncrypted: encryptSecret(sampleKey),
      status: "ready"
    });
    return NextResponse.json({ voiceId }, { status: 201 });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
