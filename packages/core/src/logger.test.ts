import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, setErrorReporter } from "./logger.js";

function captureConsole(method: "log" | "warn" | "error") {
  return vi.spyOn(console, method).mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
  setErrorReporter(() => {});
});

describe("structured logging (FAV-107/1601)", () => {
  it("emits one JSON object per line with level, event, and time", () => {
    const spy = captureConsole("log");
    createLogger().info("thing_happened", { videoId: "vid_1" });

    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("thing_happened");
    expect(parsed.videoId).toBe("vid_1");
    expect(Date.parse(parsed.time)).not.toBeNaN();
  });

  it("child loggers inherit bound correlation ids", () => {
    const spy = captureConsole("log");
    const base = createLogger({ traceId: "trc_1", orgId: "org_1" });
    base.child({ jobId: "job_1" }).info("step_done", { stage: "rendering" });

    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    // The whole chain is present, which is what makes a trace followable.
    expect(parsed).toMatchObject({
      traceId: "trc_1",
      orgId: "org_1",
      jobId: "job_1",
      stage: "rendering",
      event: "step_done"
    });
  });

  it("call-site context overrides bound context", () => {
    const spy = captureConsole("log");
    createLogger({ stage: "queued" }).info("moved", { stage: "rendering" });
    expect(JSON.parse(spy.mock.calls[0]![0] as string).stage).toBe("rendering");
  });

  it("errors serialize message and stack, and reach the error reporter", () => {
    const spy = captureConsole("error");
    const reported: Array<{ error: unknown; traceId?: unknown }> = [];
    setErrorReporter((error, context) => reported.push({ error, traceId: context.traceId }));

    const boom = new Error("render exploded");
    createLogger({ traceId: "trc_9" }).error("generation_failed", boom, { videoId: "vid_9" });

    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.level).toBe("error");
    expect(parsed.error).toBe("render exploded");
    expect(parsed.stack).toContain("Error: render exploded");
    // The reporter gets the Error object itself, not a string.
    expect(reported[0]!.error).toBe(boom);
    expect(reported[0]!.traceId).toBe("trc_9");
  });

  it("respects FAV_LOG_LEVEL", () => {
    const spy = captureConsole("log");
    vi.stubEnv("FAV_LOG_LEVEL", "warn");
    createLogger().info("suppressed");
    createLogger().debug("also_suppressed");
    expect(spy).not.toHaveBeenCalled();

    const warnSpy = captureConsole("warn");
    createLogger().warn("kept");
    expect(warnSpy).toHaveBeenCalledOnce();
    vi.unstubAllEnvs();
  });
});
