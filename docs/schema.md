# Database schema (FAV-302)

Postgres dialect via Drizzle ORM. Source of truth: `packages/db/src/schema.ts`.
Migrations live in `packages/db/migrations/` and apply identically to embedded
PGlite (dev) and managed Postgres (prod).

## ER diagram

```mermaid
erDiagram
    users ||--o{ memberships : has
    organizations ||--o{ memberships : has
    organizations ||--o{ invites : sends
    organizations ||--o{ videos : owns
    organizations ||--o{ credit_ledger : accrues
    organizations ||--o{ social_accounts : connects
    organizations ||--o{ autopilot_rules : configures
    organizations ||--o{ api_keys : issues
    organizations ||--o{ voices : "owns clones"
    videos ||--o{ scenes : contains
    videos ||--o{ jobs : "processed by"
    videos ||--o{ publish_jobs : "published via"
    jobs ||--o{ credit_ledger : "reserves/refunds"
    social_accounts ||--o{ publish_jobs : "publishes to"
    autopilot_rules ||--o{ autopilot_runs : executes
    autopilot_runs |o--o| videos : produces
    feature_flags ||--o{ feature_flag_overrides : "overridden per org"
    impersonation_sessions ||--o{ audit_log : audited

    users {
        text id PK
        text auth_provider_id UK
        text email UK
        boolean is_staff
    }
    organizations {
        text id PK
        text slug UK
        plan_tier plan
        int cached_balance "derived from ledger"
    }
    memberships {
        text org_id FK
        text user_id FK
        membership_role role "owner|admin|member"
    }
    videos {
        text id PK
        text org_id FK
        video_status status
        jsonb request
        jsonb script
        text final_asset_key
    }
    scenes {
        text id PK
        text video_id FK
        int index
        text narration
        text visual_prompt
        text image_asset_key
    }
    jobs {
        text id PK
        text org_id FK
        text video_id FK
        job_kind kind
        job_status status
        text idempotency_key UK
        text stage
    }
    credit_ledger {
        text id PK
        text org_id FK
        ledger_entry_type entry_type
        int amount "signed; balance = SUM"
        text job_id FK
        text stripe_event_id
    }
    social_accounts {
        text id PK
        text org_id FK
        social_platform platform
        text access_token_encrypted "encrypted at rest"
        text refresh_token_encrypted "encrypted at rest"
    }
    publish_jobs {
        text id PK
        text video_id FK
        text social_account_id FK
        publish_status status
        text external_post_id
    }
    autopilot_rules {
        text id PK
        text org_id FK
        text cadence
        boolean enabled
        timestamptz next_run_at
    }
    voices {
        text id PK
        text org_id FK "null = global library"
        boolean is_clone
        text clone_sample_key_encrypted "encrypted at rest"
    }
    api_keys {
        text id PK
        text org_id FK
        text key_hash UK "sha-256, plaintext never stored"
        jsonb scopes
    }
```

## Ledger semantics (FAV-303 / FAV-904)

| entry_type | sign | when |
|---|---|---|
| `grant` | + | subscription grant, starter credits, monthly reset |
| `purchase` | + | one-time top-up (never expires) |
| `reservation` | − | job start; guarded by race-safe balance check |
| `reservation_release` | + | job success where actual cost < reserved |
| `refund` | + | terminal job failure — full compensation |
| `adjustment` | ± | manual admin action (audited) |
| `reset` | ± | monthly allotment reconciliation |

Invariants (unit-tested in `packages/db/src/ledger.test.ts`):
- rows are never updated or deleted; balance = `SUM(amount)` per org
- at most one `reservation`, `reservation_release`, and `refund` per job
  (partial unique index), so workflow retries can't double-charge
- `organizations.cached_balance` is a cache, recomputed from the ledger
