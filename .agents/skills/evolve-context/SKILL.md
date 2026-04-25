---
name: evolve-context
description: Self-evolving context protocol across ABC-split root files (AGENTS.md, BACKLOG.md, CHANGELOG.md), human entrypoint README.md files tree, and /docs. Use after meaningful project changes, backlog drift, documentation refactors, or when you want a forced context reconciliation pass.
metadata:
  version: 1.2.0
---

# Evolve Context

## Basics

### Activation

- 'POST_TASK' (default) — run the post-task protocol when reality changed enough to justify context sync
- 'ALWAYS_ON' (opt-in) — monitor every interaction; use only when explicitly requested
- 'ON_REQUEST' — full context lifecycle audit when the user asks

### Paths

- '`SKILL_DIR`' — the directory containing this `SKILL.md` file
- 'Scripts': `${SKILL_DIR}/scripts/`
- 'Detailed docs': [`${SKILL_DIR}/docs/protocols.md`](./docs/protocols.md)

### Managed Targets

- 'Root README': `README.md` — top-level human entry point and root navigation
- 'Subtree README files': `**/README.md` — local human entry points for subsystems, workspaces, packages, and tools
- 'Durable protocol': `AGENTS.md` (fallbacks: `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, `CONTEXT.md`)
- 'Canonical open-work file': `BACKLOG.md` (fallbacks: `TODO.md`, `PLAN.md`, `ROADMAP.md`)
- 'Completed delivery history': `CHANGELOG.md`
- 'Docs index': `/docs/README.md`
- 'Project docs': `/docs/`

## Purpose

Maintain a living knowledge system with a truthful split between durable protocol, open work, completed delivery, human entrypoint README files, and subsystem documentation.

'Core guarantee': Durable rules stay durable. Open work stays open. Completed work moves to history. README entrypoints stay trustworthy. Docs stay discoverable.

## Axioms

### A1: Reflexive Integrity

The protocol applies its own rules to itself. Process context (`AGENTS.md`) ≠ open work (`BACKLOG.md`) ≠ completed delivery (`CHANGELOG.md`) ≠ subsystem docs (`/docs`).

### A2: Constraint-Driven Evolution

Complexity is earned through discovered constraints, not invented upfront. But once those constraints are real, the protocol should actively restructure flat or drifting context into a more truthful hierarchy instead of preserving accidental shape forever.

### A3: Single Source of Truth

Every fact lives in exactly one authoritative place. Navigate by hierarchy; do not duplicate state across root files.

### A4: Root State Separation

Preferred organic standard: `AGENTS.md` + `BACKLOG.md` + `CHANGELOG.md`.

- `AGENTS.md` — durable protocol, conventions, naming, architectural memory
- `BACKLOG.md` — what remains open, blocked, gated, or next
- `CHANGELOG.md` — what has landed

### A5: Backlog State Truth

Docs, code, and changelog updates do not implicitly close plan items. If reality changed, the canonical open-work file must change in the same pass.

### A6: Human Entrypoint Continuity

`README.md` files are not decorative. Root and subtree README files are the human navigation plane and must be kept honest when topology, setup, ownership, or usage reality changes.

## Root Memory Architecture

```text
README.md        ← root human entry point
*/README.md      ← subtree human entry points
AGENTS.md        ← durable protocol / context / conventions
BACKLOG.md       ← canonical open work / next slices / gates
CHANGELOG.md     ← completed delivery history
docs/README.md   ← documentation index
docs/*           ← subsystem contracts and architecture
```

### Routing Decision Tree

```text
About project identity / top-level entry?   → README.md
About a subsystem starting point?           → nearest relevant subtree README.md
About how we work?                          → AGENTS.md
About what remains open?                    → BACKLOG.md
About what landed already?                  → CHANGELOG.md
About what we build or ship?                → /docs/*, then sync docs/README.md
```

### Connectivity Invariant

- Root `README.md` should expose the full root control plane: `AGENTS.md`, `BACKLOG.md`, `CHANGELOG.md`, and `docs/README.md`
- Subtree `README.md` files should remain reachable from some parent/root/docs navigation path
- When a subtree becomes a real human entry point, its local `README.md` should be updated alongside the corresponding ABC and `/docs` truth

## Activation Modes

### Mode 1: POST_TASK (Default)

'Trigger decision tree':

```text
Task touched any *.md file?              → YES → run POST_TASK
                                          NO  → Changed public APIs/architecture? → YES → run POST_TASK
                                                                                   NO  → Changed canonical backlog state? → YES → run POST_TASK
                                                                                                                         NO  → Completed a meaningful slice? → YES → run POST_TASK
                                                                                                                                                              NO  → skip
```

'Farmville guard': Before writing any update, ask: "Does this preserve durable wisdom, correct open-work truth, record completed delivery, or repair README/docs discoverability?" If no → skip. Silence is a valid output.

'Light post-task' (small scoped task, no architecture shift):

1. EVALUATE — anything worth capturing?
2. BACKLOG SYNC — close, narrow, split, retarget, or gate open work if reality changed
3. README SYNC — update the touched root/subtree README entrypoints when setup, ownership, layout, usage truth, or same-domain insights changed
4. DOCS SYNC — update the appropriate contract/architecture doc when implementation or public behavior changed
5. CHANGELOG SYNC — record the delivered slice if something materially landed
6. AGENTS SYNC — update durable protocol only if a reusable pattern or constraint emerged
7. CONNECTIVITY SYNC — keep README reachability and `docs/README.md` honest when touched scope changed navigation

'Full post-task' (broad diff, architectural impact, or context refactor):

1. EVALUATE — anything worth capturing?
2. BACKLOG SYNC — repair open-work truth first
3. README SYNC — reconcile root and subtree README entrypoints with the shipped state and same-domain lessons from the work
4. DOCS SYNC — update the relevant subsystem docs
5. CHANGELOG SYNC — add the completed delivery entry
6. AGENTS SYNC — promote reusable insight into durable protocol
7. CONSOLIDATE — merge duplicates and remove stale context
8. CONNECTIVITY SYNC — ensure root/docs/README navigation still matches reality
9. VALIDATE — `bash "${SKILL_DIR}/scripts/validate-context"`

### Mode 2: ALWAYS_ON (Opt-in)

Only when explicitly requested. Track surprises, stale docs, stale README entrypoints, backlog drift, repeated mistakes, and root-state confusion during any task, then capture them in POST_TASK.

### Mode 3: ON_REQUEST (Explicit)

Full forced reconciliation pass across ABC + README tree + `/docs`, followed by validation. See [protocols.md](./docs/protocols.md#validation-checklist-on_request-mode).

## Pre-Task Protocol

1. READ `AGENTS.md` — align with durable conventions
2. READ `BACKLOG.md` or the canonical plan file — understand open work and current framing
3. READ the nearest relevant `README.md` files — root first, then touched subtree entrypoints
4. READ `docs/README.md` — understand documentation topology
5. REVIEW the relevant `/docs` files for the touched subsystem
6. MARK which README entrypoints sit in the same work domain and may need insight refresh after the task
7. REVIEW recent `CHANGELOG.md` entries when recent shipped baseline matters
8. PROCEED with task execution

## Entry Templates

Defaults for new files and restructuring targets for existing ones. If a file already has a format, match that format unless the current structure is clearly flatter, drifted, or less truthful than the template hierarchy — in that case, evolve it toward the template rather than preserving accidental shape.
Full templates: [`docs/templates.md`](./docs/templates.md)

### Quick Reference

'AGENTS entry':

```markdown
- '[label]': [description of insight or rule] | Trigger: [cause] | Action: [what to do]
```

'BACKLOG item':

```markdown
- [ ] `[Slice]` [Concrete remaining work with truthful exit criteria]
```

'CHANGELOG entry':

```markdown
- `[Area]` [Delivered slice]. Impact: [what changed].
```

## Tooling: `validate-context`

Automated documentation health checker for the ABC root-memory split, README entrypoint graph, and docs plane.

- 'Bootstrap': `"${SKILL_DIR}/scripts/_bootstrap"` installs `validate-context` into `~/.local/bin`
- 'Design': [`docs/validation-design.md`](./docs/validation-design.md)
- 'Usage': `bash "${SKILL_DIR}/scripts/validate-context"` from project root
- 'Override root': `VALIDATE_CONTEXT_ROOT=/path/to/project bash ...`
- 'Exit 0' = passed, 'Exit 1' = errors found

## Backlog Sync Rules

When a task changes the true state of open work, update the canonical plan file in the same pass.

Allowed plan-state operations:

- 'Close' — exit criteria now satisfied in reality
- 'Narrow' — part landed; describe only the remaining work
- 'Split' — one vague item became multiple concrete slices
- 'Retarget' — wording no longer matches the real remaining task
- 'Defer' — still valid, but not the best next slice
- 'Gate/Block' — remaining work depends on another condition

Rules:

- Keep at least one concrete next slice when an epic stays open
- Do not let docs or changelog silently carry work that still appears open in the plan
- Do not keep evergreen maintenance disciplines as unchecked backlog items; move them into `AGENTS.md` or `/docs`

## Lifecycle & Maintenance

- 'Growth control': discovery → durable rule / open slice / completed delivery / entrypoint sync
- 'GC triggers': 3+ bloat signals from validator → mandatory garbage collection
- 'Root split discipline': completed delivery belongs in `CHANGELOG.md`, not rolling `AGENTS.md` history
- 'Hybrid context discipline': serve the full context graph (`ABC + README tree + /docs`), not one layer in isolation
- 'Template-as-restructuring-target': templates are not only for greenfield bootstrapping; they are the target shape for reorganizing existing context when the current structure is flatter, drifted, or harder to navigate
- 'README domain discipline': if meaningful work happened inside a domain that has its own `README.md`, refresh that local entrypoint with the resulting insight when the README is the honest human starting point for that area
- 'Details': [protocols.md](./docs/protocols.md#context-lifecycle-management)
