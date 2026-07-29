# Workflows demo

A live demo of [Vercel Workflows](https://vercel.com/docs/workflows) — durable
functions written as ordinary async code with the `'use workflow'` and
`'use step'` directives.

Six capabilities, each a real workflow run you can start from the page:

| #   | Capability                | What it proves                                                            |
| --- | ------------------------- | ------------------------------------------------------------------------- |
| 01  | Durable execution         | Disconnect mid-run; the run keeps going and the UI backfills on reconnect. |
| 02  | Automatic retries         | A step fails on purpose and retries itself, with attempt badges.          |
| 03  | Human-in-the-loop hooks   | The run suspends at a hook until you approve or reject.                    |
| 04  | Sleep without compute     | A real 30-day `sleep()`, interrupted on demand with `run.wakeUp()`.       |
| 05  | Parallel fan-out          | `Promise.all` over steps, with an overlapping waterfall to prove it.       |
| 06  | Agents on workflows       | Each model call and tool call is its own named, retryable step.            |

Every workflow run on the page is real. The only thing ever mocked is the model
call on tab 06, and only when no gateway key is configured — the workflow around
it still runs for real, and the UI shows a `MOCK` badge.

## Running it locally

```bash
pnpm install
cp .env.example .env.local   # optional: add AI_GATEWAY_API_KEY for tab 06
pnpm build
WORKFLOW_TARGET_WORLD=local pnpm start
```

Then open http://localhost:3000.

`WORKFLOW_TARGET_WORLD=local` routes workflow state to the Local World, which
writes to `./.workflow-data/` (gitignored). It is required locally and must not
be set on Vercel, where deployments pick up the Vercel World automatically.

Inspect local runs from the terminal:

```bash
npx workflow inspect runs
```

## Environment

| Variable                | Required            | Purpose                                                                                              |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `WORKFLOW_TARGET_WORLD` | Locally only        | Set to `local` so workflow state lands in `./.workflow-data/`. Leave unset on Vercel.                 |
| `AI_GATEWAY_API_KEY`    | No                  | Real model calls on tab 06 via the AI Gateway. Absent → deterministic mock model with a `MOCK` badge. |

No other configuration is needed. Workflows need no API key of their own: on
Vercel the generated workflow handlers are registered as private queue
consumers, and locally the Local World handles storage and queueing on disk.

## Notes on the demo runs

Runs are kept deliberately cheap and short-lived, because billing is per event
plus data retained:

- Fan-out on tab 05 is capped at 8 items.
- Retries on tab 02 are capped at 3.
- Step payloads stay small; nothing large is passed through a step boundary.
- Tab 04's 30-day sleepers are cleaned up lazily — a later tab-04 request wakes
  or cancels any demo sleeper older than about an hour, so abandoned runs do not
  pile up.

A run is pinned to the deployment that started it, so a long sleep does not
survive a redeploy. That is why the sleep demo is built around `run.wakeUp()`
rather than actually waiting a month.
