#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * FAV MCP server (FAV-1505): drives video generation from AI tools
 * (Claude, Cursor, ...) by wrapping the public REST API.
 *
 * Config via env:
 *   FAV_API_URL — base URL of the app (default http://localhost:3000)
 *   FAV_API_KEY — an API key issued in the dashboard (fav_live_...)
 */

const API_URL = process.env.FAV_API_URL ?? "http://localhost:3000";
const API_KEY = process.env.FAV_API_KEY ?? "";

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`FAV API ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const server = new McpServer({ name: "fav-video", version: "1.0.0" });

server.tool(
  "generate_video",
  "Start generating a faceless video from a topic. Returns a video id to poll with get_video_status. Generation takes 1-3 minutes.",
  {
    topic: z.string().min(3).max(500).describe("What the video should be about"),
    durationSeconds: z.number().int().min(15).max(600).optional().describe("Target length, default 60"),
    aspectRatio: z.enum(["9:16", "16:9"]).optional().describe("Vertical (default) or horizontal"),
    tier: z.enum(["basic", "premium", "max"]).optional(),
    visualStyle: z.enum(["cinematic", "anime", "3d", "watercolor", "photorealistic", "minimalist"]).optional(),
    captionStyle: z.enum(["bold", "karaoke", "impact", "clean", "none"]).optional(),
    tone: z.enum(["informative", "dramatic", "casual", "inspirational", "humorous", "mysterious"]).optional()
  },
  async (args) => {
    const result = await api("/videos/generate", { method: "POST", body: JSON.stringify(args) });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_video_status",
  "Check the status of a video by id. When status is 'completed', downloadUrl holds the MP4.",
  { id: z.string().describe("The video id returned by generate_video") },
  async ({ id }) => {
    const result = await api(`/videos/${encodeURIComponent(id)}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`fav-video MCP server ready (${API_URL})`);
