# Project Backlog

## Open Backlog

No open implementation, validation, or documentation items are scheduled right now.

Completed delivery is recorded in [CHANGELOG.md](./CHANGELOG.md). Durable domain boundaries are documented in [AGENTS.md](./AGENTS.md) and [docs/architecture.md](./docs/architecture.md).

## Reopen Triggers

Create a concrete backlog slice when any of these become true:

- Runtime behavior changes or new domains expose a cohesive extraction opportunity in `index.ts`
- Validation exposes drift in Flat Domain DAG boundaries, import invariants, package contents, or Telegram rendering/queue safety
- User-visible Telegram behavior changes and needs README, docs, or changelog synchronization
- A new explicit cleanup/refactor pass is requested and has a bounded, non-cosmetic target
