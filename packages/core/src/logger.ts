/**
 * Structured logging with trace correlation (FAV-107/1601).
 *
 * Every line is a single JSON object so it's queryable in any log tool, and
 * carries the ids needed to follow one video from the HTTP request that
 * created it, through the queue, into the worker that rendered it.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  /** Correlates every line for one job across web, queue, and worker. */
  traceId?: string;
  requestId?: string;
  jobId?: string;
  videoId?: string;
  orgId?: string;
  userId?: string;
  workerId?: string;
  stage?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.FAV_LOG_LEVEL ?? "info") as LogLevel;
  return LEVEL_ORDER[configured] ?? LEVEL_ORDER.info;
}

/** Hook for shipping errors to Sentry without @fav/core depending on it. */
let errorReporter: ((error: unknown, context: LogContext) => void) | null = null;

export function setErrorReporter(reporter: (error: unknown, context: LogContext) => void): void {
  errorReporter = reporter;
}

function emit(level: LogLevel, event: string, context: LogContext): void {
  if (LEVEL_ORDER[level] < threshold()) return;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, error?: unknown, context?: LogContext): void;
  /** Derive a logger carrying additional bound context. */
  child(context: LogContext): Logger;
}

export function createLogger(bound: LogContext = {}): Logger {
  return {
    debug: (event, context) => emit("debug", event, { ...bound, ...context }),
    info: (event, context) => emit("info", event, { ...bound, ...context }),
    warn: (event, context) => emit("warn", event, { ...bound, ...context }),
    error: (event, error, context) => {
      const merged = { ...bound, ...context };
      emit("error", event, {
        ...merged,
        error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      // Reported separately so Sentry gets the Error object, not a string.
      if (error !== undefined) errorReporter?.(error, merged);
    },
    child: (context) => createLogger({ ...bound, ...context })
  };
}

export const logger = createLogger();
