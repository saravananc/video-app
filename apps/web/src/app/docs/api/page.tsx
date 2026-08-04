import Link from "next/link";

export const metadata = {
  title: "FAV API documentation",
  description: "Generate faceless videos programmatically."
};

const GENERATE_EXAMPLE = `curl -X POST https://your-app/api/v1/videos/generate \\
  -H "authorization: Bearer fav_live_..." \\
  -H "content-type: application/json" \\
  -d '{
    "topic": "how lighthouses work",
    "durationSeconds": 30,
    "aspectRatio": "9:16",
    "captionStyle": "karaoke"
  }'

# 202 Accepted
{ "id": "vid_...", "jobId": "job_...", "status": "queued", "estimatedCredits": 12 }`;

const POLL_EXAMPLE = `curl https://your-app/api/v1/videos/vid_... \\
  -H "authorization: Bearer fav_live_..."

# 200 OK — poll until status is "completed" or "failed"
{
  "id": "vid_...",
  "status": "completed",
  "title": "How lighthouses work",
  "progressPercent": 100,
  "durationSeconds": 31.4,
  "creditsCharged": 12,
  "downloadUrl": "https://..."
}`;

const MCP_EXAMPLE = `{
  "mcpServers": {
    "fav-video": {
      "command": "node",
      "args": ["/path/to/apps/mcp/dist/server.js"],
      "env": {
        "FAV_API_URL": "https://your-app",
        "FAV_API_KEY": "fav_live_..."
      }
    }
  }
}`;

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border-token bg-bg-subtle p-4 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

/** Developer documentation for the public API (FAV-1504). */
export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-xs text-text-muted hover:text-text">
        ← FAV Studio
      </Link>
      <h1 className="mt-2 text-3xl font-bold">API documentation</h1>
      <p className="mt-2 text-text-muted">
        Generate faceless videos programmatically. Generation is asynchronous: create a video, then poll
        until it completes.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Authentication</h2>
        <p className="mt-2 text-sm text-text-muted">
          Issue a key under <Link href="/dashboard/api-keys" className="text-accent">API keys</Link> and send it
          as a bearer token. The plaintext key is shown once at creation — only a hash is stored, so it can&apos;t
          be recovered later. Keys are scoped (<code className="text-xs">videos:read</code>,{" "}
          <code className="text-xs">videos:write</code>) and can be revoked at any time, which takes effect
          immediately.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Generate a video</h2>
        <p className="mb-3 mt-2 text-sm text-text-muted">
          <code className="text-xs">POST /api/v1/videos/generate</code> — returns immediately with an id.
          Credits are reserved up front and refunded automatically if generation fails.
        </p>
        <Code>{GENERATE_EXAMPLE}</Code>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Check status</h2>
        <p className="mb-3 mt-2 text-sm text-text-muted">
          <code className="text-xs">GET /api/v1/videos/{"{id}"}</code> — poll every few seconds. Typical
          generation takes one to three minutes. <code className="text-xs">downloadUrl</code> appears once the
          status is <code className="text-xs">completed</code> and is a short-lived signed link.
        </p>
        <Code>{POLL_EXAMPLE}</Code>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Responses</h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-border-token">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase text-text-muted">
              <tr>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["202", "Accepted — generation queued"],
                ["400", "invalid_request — see details for the failing fields"],
                ["401", "Missing or invalid API key"],
                ["402", "insufficient_credits — includes required and available"],
                ["403", "Key lacks the required scope, or the API is disabled for your org"],
                ["404", "not_found — unknown video, or not yours"],
                ["429", "rate_limit_exceeded — retry after retryAfterSeconds"]
              ].map(([code, meaning]) => (
                <tr key={code} className="border-t border-border-token">
                  <td className="px-4 py-2 font-mono text-xs">{code}</td>
                  <td className="px-4 py-2 text-text-muted">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">MCP server</h2>
        <p className="mb-3 mt-2 text-sm text-text-muted">
          Drive generation from Claude, Cursor, or any MCP client. The server exposes{" "}
          <code className="text-xs">generate_video</code> and <code className="text-xs">get_video_status</code>.
        </p>
        <Code>{MCP_EXAMPLE}</Code>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">OpenAPI</h2>
        <p className="mt-2 text-sm text-text-muted">
          The machine-readable spec lives at{" "}
          <a href="/api/v1/openapi.json" className="text-accent" target="_blank">
            /api/v1/openapi.json
          </a>{" "}
          — point your client generator at it.
        </p>
      </section>
    </main>
  );
}
