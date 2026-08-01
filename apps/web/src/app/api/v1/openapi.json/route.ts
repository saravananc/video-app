import { NextResponse } from "next/server";

/** OpenAPI spec for the public API (FAV-1504). */
const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "FAV Public API",
    version: "1.0.0",
    description:
      "Programmatic faceless-video generation. Authenticate with an API key from your dashboard: `Authorization: Bearer fav_live_...`. Generation is async — create, then poll."
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      apiKey: { type: "http", scheme: "bearer", description: "API key (fav_live_...)" }
    },
    schemas: {
      VideoRequest: {
        type: "object",
        required: ["topic"],
        properties: {
          topic: { type: "string", minLength: 3, maxLength: 500 },
          durationSeconds: { type: "integer", minimum: 15, maximum: 600, default: 60 },
          aspectRatio: { type: "string", enum: ["9:16", "16:9"], default: "9:16" },
          resolution: { type: "string", enum: ["1080p", "4k"], default: "1080p" },
          tier: { type: "string", enum: ["basic", "premium", "max"], default: "basic" },
          visualStyle: {
            type: "string",
            enum: ["cinematic", "anime", "3d", "watercolor", "photorealistic", "minimalist"],
            default: "cinematic"
          },
          captionStyle: { type: "string", enum: ["bold", "karaoke", "impact", "clean", "none"], default: "bold" },
          transition: { type: "string", enum: ["none", "fade", "slide", "zoom"], default: "fade" },
          tone: {
            type: "string",
            enum: ["informative", "dramatic", "casual", "inspirational", "humorous", "mysterious"],
            default: "informative"
          },
          voiceId: { type: "string" },
          language: { type: "string", default: "en" },
          musicTrackId: { type: "string" }
        }
      },
      VideoStatus: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: {
            type: "string",
            enum: ["draft", "queued", "generating", "rendering", "completed", "failed", "canceled"]
          },
          title: { type: "string" },
          progressPercent: { type: ["integer", "null"] },
          durationSeconds: { type: ["number", "null"] },
          creditsCharged: { type: ["integer", "null"] },
          error: { type: ["string", "null"] },
          downloadUrl: { type: ["string", "null"], description: "Signed URL, present when completed" }
        }
      }
    }
  },
  security: [{ apiKey: [] }],
  paths: {
    "/videos/generate": {
      post: {
        summary: "Generate a video (async)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/VideoRequest" } } }
        },
        responses: {
          "202": { description: "Accepted — poll GET /videos/{id}" },
          "401": { description: "Invalid API key" },
          "402": { description: "Insufficient credits" },
          "429": { description: "Rate limited — see retryAfterSeconds" }
        }
      }
    },
    "/videos/{id}": {
      get: {
        summary: "Get video status",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Video status",
            content: { "application/json": { schema: { $ref: "#/components/schemas/VideoStatus" } } }
          },
          "404": { description: "Not found" }
        }
      }
    }
  }
} as const;

export function GET() {
  return NextResponse.json(SPEC);
}
