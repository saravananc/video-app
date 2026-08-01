/** Streaming host abstraction (FAV-1002): Mux in prod, direct MP4 in dev. */

export interface StreamingProvider {
  readonly name: string;
  /** Ingest a video by URL; returns a playback id, or null when unsupported (direct playback). */
  ingest(videoUrl: string): Promise<{ playbackId: string; thumbnailUrl: string } | null>;
  playbackUrl(playbackId: string): string;
}

export class DirectStreamingProvider implements StreamingProvider {
  readonly name = "direct";

  async ingest(): Promise<null> {
    return null; // dev: play the signed MP4 URL directly
  }

  playbackUrl(): string {
    throw new Error("Direct streaming has no playback ids");
  }
}

export class MuxStreamingProvider implements StreamingProvider {
  readonly name = "mux";

  constructor(
    private readonly tokenId: string,
    private readonly tokenSecret: string
  ) {}

  private auth(): string {
    return `Basic ${Buffer.from(`${this.tokenId}:${this.tokenSecret}`).toString("base64")}`;
  }

  async ingest(videoUrl: string) {
    const res = await fetch("https://api.mux.com/video/v1/assets", {
      method: "POST",
      headers: { authorization: this.auth(), "content-type": "application/json" },
      body: JSON.stringify({
        input: [{ url: videoUrl }],
        playback_policy: ["public"],
        video_quality: "basic"
      })
    });
    if (!res.ok) throw new Error(`Mux HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      data: { playback_ids?: Array<{ id: string }> };
    };
    const playbackId = body.data.playback_ids?.[0]?.id;
    if (!playbackId) throw new Error("Mux returned no playback id");
    return {
      playbackId,
      thumbnailUrl: `https://image.mux.com/${playbackId}/thumbnail.png?time=1`
    };
  }

  playbackUrl(playbackId: string): string {
    return `https://stream.mux.com/${playbackId}.m3u8`;
  }
}

export function getStreamingProvider(): StreamingProvider {
  const { MUX_TOKEN_ID, MUX_TOKEN_SECRET } = process.env;
  if (MUX_TOKEN_ID && MUX_TOKEN_SECRET) return new MuxStreamingProvider(MUX_TOKEN_ID, MUX_TOKEN_SECRET);
  return new DirectStreamingProvider();
}
