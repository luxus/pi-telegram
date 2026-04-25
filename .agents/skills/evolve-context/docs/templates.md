# Entry Templates

Default templates for new or empty files managed by the Context Evolution Protocol.
If a file already has an established format, use **that** format instead.

## Root Starter (`README.md` + `AGENTS.md` + `BACKLOG.md` + `CHANGELOG.md`)

Choose the `AGENTS.md` starter that matches project maturity.

- 'Lean': early projects, low coordination load, few durable constraints
- 'Layered mature project': repositories with multiple subsystems, stronger naming/contracts, or autonomous-agent coordination pressure

### `README.md`

```markdown
# [Project Name]

[One-sentence explanation of what this project is]

## Start Here

- [Project Context](./AGENTS.md)
- [Open Backlog](./BACKLOG.md)
- [Changelog](./CHANGELOG.md)
- [Documentation](./docs/README.md)
```

### `AGENTS.md` — Lean

Use when the project is still simple and the context burden is low.
Even the lean starter should include a minimal meta-protocol layer so the file can explain how it evolves.

```markdown
# Project Context

## Meta-Protocol Principles

- `Constraint-Driven Evolution`: Add structure when real constraints justify it
- `Single Source of Truth`: Each fact lives in one authoritative layer
- `Context Hygiene`: Compress, consolidate, and remove stale context before it turns into drag
- `Boundary Clarity`: Keep durable protocol, open work, completed delivery, and docs in distinct files

## Concept

[One-sentence project purpose]

## Topology

- `/[directory]/`: [Purpose]

## Durable Conventions

- '[label]': [Constraint or rule] | Trigger: [cause] | Action: [what to do]
```

### `AGENTS.md` — Layered Mature Project

Use when the project needs a durable, hierarchical protocol rather than a tiny note file.
This mirrors the evolved style used by mature repositories: general → specific, concept before topology, topology before implementation, conventions before task checklists.
This is also the preferred restructuring target when an existing `AGENTS.md` already carries enough weight that a flat layout is no longer truthful.

```markdown
# Project Context

## 0. Meta-Protocol Principles

- `Constraint-Driven Evolution`: Add complexity only when discovered constraints justify it
- `Single Source of Truth`: Durable protocol, open work, completed delivery, and subsystem docs must not silently duplicate one another
- `Decreasing Abstraction Structure`: Organize context from the most general mental model down to execution protocols
- `Context Optimization`: Consolidate, compress, and remove stale structure before context turns into entropy
- `Boundary Clarity`: Keep product identity, architecture, operations, and task rituals in separate sections so one layer does not leak into another
- `Validation Infrastructure`: Pair structural rules with explicit validation and completion checks
- `Human + Agent Coherence`: The same context graph should make sense to a future human and a future agent
- `Template as Target Shape`: If the inherited structure is flatter or drifted, restructure it toward this hierarchy instead of preserving accidental form

## 1. Concept

[What the project is, what problem it solves, product boundary]

## 2. Identity & Naming Contract

- [Canonical terms and naming boundaries]

## 3. Project Topology

- `/[directory]/`: [Purpose]

## 4. Core Entities

- [Durable domain atoms]

## 5. Architectural Decisions

- [Stable design decisions and launch-line constraints]

## 6. Engineering Conventions

- [Validation, code standards, implementation discipline]

## 7. Operational Conventions

- [Docs policy, frontend/tooling provenance, coordination rules]

## 8. Integration Protocols

- [Upstream/runtime/network/integration seams]

## 9. Pre-Task Preparation Protocol

- [What to read and align before work]

## 10. Task Completion Protocol

- [Validation, sync, and completion gates]
```

### `BACKLOG.md`

```markdown
# Project Backlog

## Open Backlog

- [ ] `[Slice]` [Concrete remaining work with truthful exit criteria]
```

### `CHANGELOG.md`

```markdown
# Changelog

## [Version or Current]

- `[Area]` [Delivered slice]. Impact: [what changed].
```

## AGENTS Restructuring Note

Templates are not only for new projects.
When an existing `AGENTS.md` has grown organically but lost hierarchy, use the lean or layered template as the target structure and migrate existing material into the appropriate sections instead of preserving the old flat shape.

## Index File Entry Template

For adding insights, conventions, or constraints to `AGENTS.md`:

```markdown
- '[short label]': [description of insight or constraint]
  - Trigger: [what caused this to be discovered]
  - Action: [what to do when this applies]
```

## Subtree README Template

For a real subsystem/workspace/package entrypoint:

```markdown
# [Area Name]

[One-sentence explanation of what lives here]

## What This Area Owns

- [Responsibility]

## Key Entry Points

- [Relevant file or directory](./path)
- [Related docs or parent navigation](../README.md)
```

## Docs Index Template (`docs/README.md`)

```markdown
# Documentation Index

Living index of all documentation in the `/docs` directory.

## Documents

| Document                     | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| [filename.md](./filename.md) | Brief description of what this document covers |
```

## Project Document Template

For new files in `/docs/`:

```markdown
# [Document Title]

## Overview

[1-2 sentence summary of what this document covers and why it exists.]

## [Main Sections]

[Content organized general → specific, matching project conventions.]

## Related

- [Links to related documents within /docs or external references]
```

## Backlog Item Template

```markdown
- [ ] `[Slice]` [Concrete remaining work]
```

## README Insight Update Pattern

When meaningful work happened inside a domain that already has a `README.md`, refresh that README with the local truth the next human needs first:

```markdown
## Current Status

- [What this area now does or exposes]
- [Any changed entrypoint, workflow, or boundary]
```

## Changelog Entry Template

```markdown
- `[Area]` [Delivered slice]. Impact: [what changed]. Insight: [lesson learned if needed].
```
