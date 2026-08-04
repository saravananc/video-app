import * as Sentry from "@sentry/nextjs";
import { setErrorReporter } from "@fav/core";

/**
 * Server-side error tracking (FAV-107). Initialization is a no-op without
 * SENTRY_DSN, so development and CI stay quiet and offline.
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Credentials and signed URLs must never reach an error tracker.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.cookie;
        delete event.request.headers.authorization;
      }
      return event;
    }
  });

  // Structured-log errors flow to Sentry with their correlation ids attached.
  setErrorReporter((error, context) => {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined) scope.setTag(key, String(value));
      }
      if (context.traceId) scope.setTransactionName(String(context.traceId));
      Sentry.captureException(error);
    });
  });
}
