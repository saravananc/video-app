/**
 * Model gateway resilience (FAV-501/906): retry with jitter, a circuit breaker
 * per provider, and primary->fallback failover. Wraps any async call the
 * pipeline makes against an external model provider.
 */

export interface CircuitBreakerOptions {
  /** Consecutive failures before the breaker opens. */
  failureThreshold: number;
  /** How long the breaker stays open before allowing a probe call. */
  resetAfterMs: number;
}

type BreakerState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;

  constructor(
    readonly name: string,
    private readonly options: CircuitBreakerOptions = { failureThreshold: 3, resetAfterMs: 60_000 }
  ) {}

  get currentState(): BreakerState {
    if (this.state === "open" && Date.now() - this.openedAt >= this.options.resetAfterMs) {
      this.state = "half-open";
    }
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.currentState;
    if (state === "open") {
      throw new CircuitOpenError(this.name);
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.state = "closed";
      return result;
    } catch (err) {
      this.failures++;
      if (this.failures >= this.options.failureThreshold || state === "half-open") {
        this.state = "open";
        this.openedAt = Date.now();
        console.warn(JSON.stringify({ event: "circuit_open", breaker: this.name, failures: this.failures }));
      }
      throw err;
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(breaker: string) {
    super(`Circuit breaker open for ${breaker}`);
    this.name = "CircuitOpenError";
  }
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts, baseDelayMs }: RetryOptions = { attempts: 3, baseDelayMs: 400 }
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      // Full jitter backoff.
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i * Math.random()));
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof CircuitOpenError) throw err; // don't hammer an open breaker
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const breakers = new Map<string, CircuitBreaker>();

export function breakerFor(name: string): CircuitBreaker {
  let b = breakers.get(name);
  if (!b) {
    b = new CircuitBreaker(name);
    breakers.set(name, b);
  }
  return b;
}

/** Health snapshot for ops (FAV-906 AC: health surfaced). */
export function breakerHealth(): Array<{ name: string; state: BreakerState }> {
  return [...breakers.values()].map((b) => ({ name: b.name, state: b.currentState }));
}

/**
 * Run against the primary provider; on failure (or open breaker) fail over to
 * the fallback. Each provider gets its own breaker + retry envelope.
 */
export async function withFallback<T>(
  primary: { name: string; fn: () => Promise<T> },
  fallback?: { name: string; fn: () => Promise<T> }
): Promise<T> {
  try {
    return await withRetry(() => breakerFor(primary.name).exec(primary.fn));
  } catch (primaryError) {
    if (!fallback) throw primaryError;
    console.warn(
      JSON.stringify({ event: "provider_failover", from: primary.name, to: fallback.name, error: String(primaryError) })
    );
    return withRetry(() => breakerFor(fallback.name).exec(fallback.fn));
  }
}
