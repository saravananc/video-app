/**
 * Job handoff (FAV-901/807).
 *
 * Enqueuing is a row insert in the jobs table — that write *is* the durable
 * handoff, so work survives a restart between the HTTP response and execution.
 * Workers claim from the queue: the embedded one started at server boot (see
 * lib/boot.ts) in dev, or the apps/worker pool in production.
 *
 * These helpers exist so route handlers read clearly at the call site. There is
 * deliberately nothing to do here: any worker in the fleet may pick the job up,
 * and it is already durably queued by the time these run.
 */

export function kickGenerationJob(_jobId: string): void {}

export function kickRerollJob(_jobId: string): void {}

export function kickPublishJob(_publishJobId: string): void {}
