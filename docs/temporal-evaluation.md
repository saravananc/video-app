# FAV-907: Temporal migration spike

**Recommendation: no-go for now.** Keep the Postgres-backed queue. Revisit at
the trigger conditions below.

## What we have

`packages/workflows/src/queue.ts` uses the `jobs` table as the queue:

- claims via `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)`, so
  many workers pull concurrently without coordination
- a time-boxed lease renewed by heartbeat; a dead worker's job is reclaimed
  when the lease lapses
- every pipeline step is idempotent on domain state, so a reclaimed job
  resumes rather than repeating paid provider calls
- credits reserve → finalize/refund with partial unique indexes making the
  ledger safe against double-charging on retry

Measured in this environment: a `SIGKILL`ed worker's job was reclaimed by
another worker as attempt 2 and completed with exactly one reservation and one
release in the ledger. Two workers split three jobs with exactly one render
each.

## What Temporal would add

| Capability | Temporal | Today |
|---|---|---|
| Durable execution | Automatic replay from event history | Idempotent steps re-run from domain state |
| Retry policies | Declarative, per-activity | Per-provider retry in the model gateway |
| Long timers / sleeps | First-class (`workflow.sleep` for days) | Cron sweep over `next_run_at` |
| Visibility | Web UI with full execution history | `jobs` table + admin dashboard |
| Signals / queries | Built in | Not needed by any current flow |
| Versioning | Explicit workflow versioning | Deploy-time; jobs are short-lived |

## Why no-go

**The pain Temporal solves isn't the pain we have.** Its core value is durable
execution for workflows that run for days and need replay-safe determinism.
Our longest workflow is a single video generation at roughly 90 seconds; the
crash-recovery story is already handled by leases plus idempotency, and we have
tests proving it.

**Operational cost is real.** Temporal means either Temporal Cloud (a per-action
bill on top of our provider spend) or self-hosting a cluster — server,
matching, history, and worker services plus its own Postgres or Cassandra. That
is a second stateful system to run, monitor, and upgrade for a product whose
entire state today fits in one Postgres we already operate.

**Determinism constraints would force a rewrite.** Temporal workflow code must
be deterministic and replayable: no direct I/O, no `Date.now()`, no random ids
in the workflow body. Our pipeline reads and writes the database and calls
providers inline. Every step would have to move into activities, and the
convenient inline logic — progress writes, scene fan-out, cost accumulation —
would need restructuring. That is a meaningful rewrite of the most
correctness-critical code in the product, in exchange for guarantees we
currently get from idempotency.

**Cost comparison at current shape.** At 10k videos/month our queue adds
roughly nothing: the `jobs` table is a few thousand rows and the claim query is
a single indexed statement. Temporal Cloud pricing is per action, and a
generation workflow with ~10 steps plus heartbeats is on the order of 50–100
actions, so 10k videos lands in the region of 0.5–1M actions/month — a real
line item to buy capabilities we aren't using.

## Revisit when any of these is true

1. **Queue depth outgrows Postgres.** Sustained claim contention or the `jobs`
   table becoming a hotspot — visible as rising claim latency in
   `GET /api/admin/health`. Roughly north of a few hundred jobs/minute.
2. **Workflows get long or human-in-the-loop.** Autopilot with multi-day
   editorial review gates, or anything that must sleep for days and survive
   deploys, is where Temporal timers genuinely beat a cron sweep.
3. **Cross-service orchestration.** If generation spans several independently
   deployed services, Temporal's history and visibility earn their cost in
   debugging time.
4. **Compliance needs full execution history.** Replayable audit of every step
   is something we'd otherwise have to build.

## If we do migrate

The workflow functions are already step-shaped, which is most of the work:

1. Move each step in `runGenerationJob` into a Temporal activity — they are
   already idempotent and independently retryable, so the boundaries exist.
2. Keep the credit ledger exactly as is. Reserve/finalize/refund is domain
   logic, not orchestration, and its correctness is independently tested.
3. Replace `startWorker` with a Temporal worker; keep `apps/worker` as the
   process boundary so deployment topology doesn't change.
4. Retain the `jobs` table as the read model backing the progress UI and admin
   tooling, written from activities rather than being the queue itself.

Estimated 2–3 weeks including infrastructure, plus ongoing operational
ownership of the cluster.
