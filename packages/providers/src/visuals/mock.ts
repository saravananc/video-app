import { dimensionsFor, COST_TABLE, type VisualStyle } from "@fav/core";
import type { ClipResult, ImageResult, VisualsProvider } from "../types.js";

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Style-driven palettes so different visual styles are visibly distinct (FAV-506). */
const PALETTES: Record<VisualStyle, [string, string, string]> = {
  cinematic: ["#1a1a2e", "#e94560", "#0f3460"],
  anime: ["#ff6b9d", "#a44cd3", "#2b1055"],
  "3d": ["#00b4d8", "#0077b6", "#03045e"],
  watercolor: ["#83c5be", "#006d77", "#edf6f9"],
  photorealistic: ["#3a3a3a", "#8d99ae", "#2b2d42"],
  minimalist: ["#f8f9fa", "#212529", "#dee2e6"]
};

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Deterministic placeholder art (SVG): gradient scene keyed to the prompt hash,
 * decorative geometry, and the prompt text — visibly unique per scene so motion,
 * transitions, and captions can be judged in renders without any image API.
 */
export class MockVisualsProvider implements VisualsProvider {
  readonly name = "mock";

  async generateImage(args: Parameters<VisualsProvider["generateImage"]>[0]): Promise<ImageResult> {
    const { width, height } = dimensionsFor(args.aspectRatio, args.resolution);
    const seed = (args.seed ?? 0) + hash(args.prompt);
    const [c1, c2, c3] = PALETTES[args.style];
    const angle = seed % 360;
    const shapes = Array.from({ length: 6 }, (_, i) => {
      const cx = ((seed * (i + 3)) % 100) / 100;
      const cy = ((seed * (i + 7)) % 100) / 100;
      const r = 0.06 + (((seed * (i + 11)) % 20) / 100) * 1.2;
      const color = [c1, c2, c3][i % 3];
      return `<circle cx="${(cx * width).toFixed(0)}" cy="${(cy * height).toFixed(0)}" r="${(r * Math.min(width, height)).toFixed(0)}" fill="${color}" opacity="0.35"/>`;
    }).join("");
    const label = escapeXml(args.prompt.slice(0, 90));
    const fontSize = Math.round(Math.min(width, height) / 28);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="55%" stop-color="${c3}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  ${shapes}
  <text x="50%" y="92%" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" fill="#ffffff" opacity="0.65">${label}</text>
</svg>`;

    return {
      data: Buffer.from(svg, "utf8"),
      contentType: "image/svg+xml",
      extension: "svg",
      costCredits: COST_TABLE.imagePerScene[args.tier]
    };
  }

  async generateClip(): Promise<ClipResult | null> {
    // Graceful downgrade: no clip capability in mock -> pipeline falls back to stills (FAV-503 AC).
    return null;
  }
}
