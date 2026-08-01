import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { RENDER_TIMEOUT_MS } from "@fav/core";
import { renderPropsSchema, type RenderProps } from "./props.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Pre-installed Chromium (sandbox/CI) or Remotion's own download as fallback. */
function chromiumExecutable(): string | undefined {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return undefined;
}

let cachedBundle: string | null = null;

async function getBundle(): Promise<string> {
  if (cachedBundle) return cachedBundle;
  // The Remotion bundler compiles the TSX entry itself — sources ship with the package.
  const entryPoint = path.resolve(HERE, "..", "src", "entry.tsx");
  cachedBundle = await bundle({ entryPoint });
  return cachedBundle;
}

export class RenderTimeoutError extends Error {
  constructor(afterMs: number) {
    super(`Render exceeded hard timeout of ${afterMs}ms`);
    this.name = "RenderTimeoutError";
  }
}

/**
 * Render the final MP4 (FAV-801/808): parameterized composition, hard timeout,
 * progress callback for the job record.
 */
export async function renderVideo(args: {
  props: RenderProps;
  outPath: string;
  onProgress?: (percent: number) => void;
  timeoutMs?: number;
}): Promise<{ outPath: string; sizeBytes: number }> {
  const props = renderPropsSchema.parse(args.props);
  const timeoutMs = args.timeoutMs ?? RENDER_TIMEOUT_MS;
  await mkdir(path.dirname(args.outPath), { recursive: true });

  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id: "FavVideo",
    inputProps: props,
    browserExecutable: chromiumExecutable(),
    timeoutInMilliseconds: 60_000
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
  }, timeoutMs);

  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: args.outPath,
      inputProps: props,
      browserExecutable: chromiumExecutable(),
      timeoutInMilliseconds: 60_000,
      onProgress: ({ progress }) => {
        if (timedOut) throw new RenderTimeoutError(timeoutMs);
        args.onProgress?.(Math.round(progress * 100));
      },
      chromiumOptions: { disableWebSecurity: false, headless: true }
    });
  } finally {
    clearTimeout(timer);
  }

  const { statSync } = await import("node:fs");
  const sizeBytes = statSync(args.outPath).size;
  return { outPath: args.outPath, sizeBytes };
}
