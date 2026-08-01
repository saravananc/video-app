import { dimensionsFor, COST_TABLE } from "@fav/core";
import type { ClipResult, ImageResult, VisualsProvider } from "../types.js";

/** FLUX model per tier (FAV-502: basic + premium image tiers). */
const IMAGE_MODELS = {
  basic: "fal-ai/flux/schnell",
  premium: "fal-ai/flux-pro",
  max: "fal-ai/flux-pro"
} as const;

const CLIP_MODEL = "fal-ai/kling-video/v1.6/standard/text-to-video";

/**
 * Real adapter over fal.ai's queue-less sync endpoints (FAV-501).
 * Cost per call is recorded in the returned result (FAV-501 AC).
 */
export class FalVisualsProvider implements VisualsProvider {
  readonly name = "fal";

  constructor(private readonly apiKey: string) {}

  private async invoke(model: string, input: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: {
        authorization: `Key ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });
    if (!res.ok) throw new Error(`fal.ai HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async generateImage(args: Parameters<VisualsProvider["generateImage"]>[0]): Promise<ImageResult> {
    const { width, height } = dimensionsFor(args.aspectRatio, args.resolution);
    const result = (await this.invoke(IMAGE_MODELS[args.tier], {
      prompt: `${args.style} style. ${args.prompt}`,
      image_size: { width: Math.min(width, 1920), height: Math.min(height, 1920) },
      seed: args.seed
    })) as { images: Array<{ url: string; content_type?: string }> };

    const imageUrl = result.images[0]?.url;
    if (!imageUrl) throw new Error("fal.ai returned no image");
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`fal.ai image fetch HTTP ${imgRes.status}`);
    const data = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") ?? "image/png";

    return {
      data,
      contentType,
      extension: contentType.includes("jpeg") ? "jpg" : "png",
      costCredits: COST_TABLE.imagePerScene[args.tier]
    };
  }

  async generateClip(args: Parameters<VisualsProvider["generateClip"]>[0]): Promise<ClipResult | null> {
    try {
      const result = (await this.invoke(CLIP_MODEL, {
        prompt: `${args.style} style. ${args.prompt}`,
        duration: Math.min(10, Math.max(5, Math.round(args.durationSeconds))),
        aspect_ratio: args.aspectRatio
      })) as { video: { url: string } };
      const clipRes = await fetch(result.video.url);
      if (!clipRes.ok) throw new Error(`fal.ai clip fetch HTTP ${clipRes.status}`);
      const durationSeconds = Math.min(10, Math.max(5, Math.round(args.durationSeconds)));
      return {
        data: Buffer.from(await clipRes.arrayBuffer()),
        contentType: "video/mp4",
        extension: "mp4",
        durationSeconds,
        costCredits: durationSeconds * COST_TABLE.videoClipPerSecond
      };
    } catch (err) {
      // Graceful downgrade to stills if the clip model is unavailable (FAV-503 AC).
      console.warn(`fal.ai clip generation unavailable, downgrading to image: ${err}`);
      return null;
    }
  }
}
