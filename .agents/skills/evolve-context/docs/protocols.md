# Protocols Reference

Supplementary protocols for the Context Evolution Protocol.
For the compact version, see [SKILL.md](../SKILL.md).

## Adaptation Rules

When writing to any managed file:

- **Respect what exists.** Read current format before writing.
- **Match tone and structure when the current shape is already honest.** Bullets → bullets. Tables → tables.
- **Restructure when the current shape is dishonest or too flat.** If an existing file obscures the real hierarchy, evolve it toward the template instead of preserving accidental formatting.
- **If a file is empty or new:** use templates from [`templates.md`](./templates.md)
- For `AGENTS.md`, choose between the lean and layered starters based on actual project maturity; do not force the layered version onto tiny projects or the lean version onto mature multi-surface repos
- Do not leave the meta-protocol section as an empty heading: instantiate it with real governing principles, then evolve the list as constraints become explicit

## Root File Resolution

### README Entrypoint Plane

`README.md` files are the human navigation layer.

Rules:

- Root `README.md` should point to the root control plane and the primary documentation surface
- Subtree `README.md` files should explain the local area honestly once that area becomes a real entry point for humans
- When setup, topology, ownership, usage semantics, or same-domain operator/developer insight changes, update the nearest relevant `README.md` in the same pass
- If meaningful work happened inside a domain that already has its own `README.md`, treat that local README as part of completion rather than optional polish
- Prefer keeping subtree `README.md` files reachable from parent/root/docs navigation paths instead of leaving them as isolated islands

### Durable Protocol File

If an inherited `AGENTS.md` exists but is overly flat, mixed-level, or missing stable sections that the project clearly needs, restructure it toward the chosen template instead of only appending more bullets at the bottom.

Default: `AGENTS.md`.
Fallbacks: `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, `CONTEXT.md`.

Detection: scan project root for the first match. If none found, create `AGENTS.md` only if project conventions permit it.

### Canonical Open-Work File

Preferred: `BACKLOG.md`.
Fallbacks: `TODO.md`, `PLAN.md`, `ROADMAP.md`.

Rules:

- If exactly one exists, use it
- If multiple exist, use the one actively maintained for open work
- Prefer converging inherited aliases toward `BACKLOG.md`, but do not break an established project convention casually
- Do not duplicate backlog state across multiple plan files

### Completed Delivery File

Preferred and canonical: `CHANGELOG.md`.

Rules:

- Completed delivery belongs here, not as rolling iteration history in `AGENTS.md`
- If a project already keeps versioned release notes elsewhere, do not invent a parallel changelog without explicit convention support
- When both `AGENTS.md` and `CHANGELOG.md` exist, use `AGENTS.md` for durable rules and `CHANGELOG.md` for shipped history

## Context Restructuring Protocol

When `evolve-context` is invoked on an existing project, it should not behave like a passive note appender.

Preferred order:

1. Detect the current shape of `AGENTS.md`, `BACKLOG.md`, `CHANGELOG.md`, README entrypoints, and `/docs`
2. Decide whether the current structure is already truthful enough
3. If not, reorganize toward the appropriate template shape
4. Only then add the newly discovered insights into the correct layer

Restructure when:

- One file mixes durable protocol, open work, and delivered history
- `AGENTS.md` contains meaningful durable material but lacks stable hierarchy
- Repeated additions are making navigation harder instead of clearer
- README entrypoints exist but are disconnected from the navigation graph

## Context Lifecycle Management

### Growth Control Pipeline

```text
Discovery → Route to durable rule / open slice / completed delivery / README sync → Consolidation
```

## Backlog Coherence Protocol

When post-task review reveals that implementation reality and the canonical plan disagree, repair the plan in the same pass.

### Allowed backlog transitions

| Transition        | Use when                                                                  |
| ----------------- | ------------------------------------------------------------------------- |
| `Close`           | The item's exit criteria are satisfied in reality                         |
| `Narrow`          | Part landed; the item should now describe only the remaining work         |
| `Split`           | One vague item turned into multiple concrete executable slices            |
| `Retarget`        | The original wording no longer matches the actual remaining work          |
| `Defer`           | The item remains valid but is no longer the best next slice               |
| `Move to gated`   | The remaining work now depends on an external condition or approval       |
| `Move to blocked` | The work is still desired but currently blocked by another unresolved gap |

### Rules

- Epics may remain in the plan, but active execution should still expose at least one concrete next slice
- If a completed slice was not explicitly listed before work began, add or retarget the relevant item before finishing the pass
- If a docs or architecture update changes the true exit criteria of an item, update the item instead of leaving stale wording
- Evergreen maintenance disciplines belong in durable instructions or docs, not as perpetually open checkboxes
- Prefer refining existing items over creating near-duplicates

## Completed Delivery Sync

When a meaningful slice lands, record it in `CHANGELOG.md` in the same pass.

Rules:

- Write from reality, not intention
- Prefer impact-oriented entries over commit-style trivia
- Do not mirror the same delivery bullet inside `AGENTS.md`

## Garbage Collection

Triggered by heuristic signals from `validate-context`, not hardcoded line limits.
3+ bloat signals → mandatory GC. 1–2 signals → consolidation at agent discretion.

## Consolidation Triggers

| Signal                                   | Action                                                   |
| ---------------------------------------- | -------------------------------------------------------- |
| 3+ entries describe the same pattern     | Extract a strategic pattern, remove tactical duplication |
| Two sections overlap >50%                | Merge, redirect references                               |
| Section exceeds 10 entries               | Split by abstraction or consolidate                      |
| Mistake repeated despite insight         | Escalate (see ladder below)                              |
| `/docs` entry contradicts implementation | Flag for update or rewrite                               |
| Two `/docs` files cover the same topic   | Merge, update index                                      |
| `/docs` file not in `docs/README.md`     | Add to index immediately                                 |
| `README.md` link points to missing file  | Create file or remove dead link                          |

## Mistake Prevention Escalation

```text
Level 1: Insight logged in AGENTS.md
  ↓ repeated
Level 2: Convention with emphasis
  ↓ repeated
Level 3: Hard rule with validation step
  ↓ repeated
Level 4: Structural change (tooling, automation)
```

## Documentation Consolidation Protocol

When duplicate documentation is detected:

1. Identify overlapping documents
2. Determine the better home
3. Merge content: preserve unique info, resolve contradictions with implementation truth
4. Delete or deprecate the weaker document
5. Update `docs/README.md` and cross-references

## Validation Checklist (ON_REQUEST mode)

Run `validate-context` first — it automates link, structural, root-memory, and README-entrypoint checks.
Manual-only items the script cannot verify:

- [ ] No information duplicated across `AGENTS.md`, `BACKLOG.md`, `CHANGELOG.md`, README entrypoints, and `/docs`
- [ ] Entries match existing file style
- [ ] General → specific structure is maintained where the project expects it
- [ ] Canonical open-work state reflects reality for touched work
- [ ] Completed delivery is recorded in `CHANGELOG.md` when something actually landed
- [ ] Touched root/subtree `README.md` files still describe the local area honestly
- [ ] Same-domain README entrypoints were refreshed when the work produced local insights useful to a future human starting there
- [ ] Open epics still expose a concrete next slice where active execution is expected

## Related

- [SKILL.md](../SKILL.md) — compact skill definition
- [templates.md](./templates.md) — file templates
- [validation-design.md](./validation-design.md) — validator design
