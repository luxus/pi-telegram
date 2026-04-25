# Evolve Context Backlog

> Canonical open backlog for the skill.
> Pair with `AGENTS.md` for durable protocol and `CHANGELOG.md` for completed delivery history.

## Open Backlog

- [ ] `Add deeper validator checks for root-state drift:` detect more cases where the same completed slice appears both open in `BACKLOG.md` and delivered in `CHANGELOG.md` instead of stopping at file-presence and structural checks.
- [ ] `Add an ABC-style fixture project for validator regression tests:` move more self-test coverage out of inline heredocs and into a reusable fixture that models the preferred root standard directly.
- [ ] `Document coexistence with stricter project-local overlays:` explain how `evolve-context` should hand off to repository-specific gatekeepers and alignment skills without duplicating their rules.
