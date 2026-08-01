import { NextRequest, NextResponse } from "next/server";
import { getStorageProvider, FsStorageProvider } from "@fav/providers";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4"
};

/**
 * Serves dev filesystem-storage assets behind HMAC-signed, expiring URLs
 * (FAV-1001: signed URLs expire). R2 deployments never hit this route — their
 * signed URLs point at R2 directly.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const storage = getStorageProvider();
  if (!(storage instanceof FsStorageProvider)) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const { key: keyParts } = await ctx.params;
  const key = keyParts.join("/");
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!exp || !sig || !storage.verify(key, exp, sig)) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  }

  try {
    const data = await storage.get(key);
    const ext = key.split(".").pop() ?? "";
    const body = new Uint8Array(data);
    return new NextResponse(body, {
      headers: {
        "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "content-length": String(body.byteLength),
        "cache-control": "private, max-age=3600"
      }
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
