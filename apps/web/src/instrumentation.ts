/**
 * Next.js instrumentation hook (FAV-107): loads the right Sentry config for
 * the runtime the server is booting into. Runs once per process, before any
 * request is handled.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string }
) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.withScope((scope) => {
    scope.setTag("route", context.routePath);
    scope.setTag("method", request.method);
    Sentry.captureException(error);
  });
}
