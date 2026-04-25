# Validation Design — `validate-context`

## Overview

`validate-context` is the automated documentation health checker for the Context Evolution Protocol.
It validates root-memory integrity, README entrypoint reachability, link health, and documentation quality.

## Checks Performed

| #  | Check                 | Type    | Description                                                                 |
| -- | --------------------- | ------- | --------------------------------------------------------------------------- |
| 1  | Index file detection  | Error   | Scans for `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `GEMINI.md`, or `CONTEXT.md` |
| 2  | README connectivity   | Warning | Verifies root `README.md` links to the control plane and `docs/README.md`   |
| 3  | Core structure        | Warning | Verifies numbered project sections or skill-style key sections in `AGENTS.md` |
| 4  | Root state split      | Warning | Detects canonical open-work file, `CHANGELOG.md`, and duplicate delivery history in `AGENTS.md` |
| 5  | Link validation       | Error   | Validates all relative links in all `.md` files, skipping code blocks       |
| 6  | README reachability   | Warning | Detects subtree `README.md` files with no inbound markdown links            |
| 7  | Meta-Protocol         | Warning | Checks for Meta-Protocol Principles in the durable protocol file            |
| 8  | Bloat analysis        | Mixed   | Heuristic analysis of index-file health                                     |
| 9  | LaTeX detection       | Error   | Flags LaTeX syntax in `/docs/` (GitHub doesn't render it)                   |
| 10 | Freshness             | Warning | Checks durable protocol file modification age (>30 days = stale)            |
| 11 | Docs directory        | Warning | Verifies `/docs` directory exists                                           |
| 12 | Docs index coverage   | Warning | Detects orphans and phantoms in `docs/README.md`                            |

## Bloat Heuristics

Instead of a hardcoded line limit, the script uses independent signals:

1. 'Low information density' (<40% structural elements) — verbose prose needs consolidation
2. 'Disproportionate sections' (>2× average section size, minimum 20 lines) — specific section needs trimming
3. 'Sparse structure' (>15 lines per heading) — reorganization needed

Verdict:

- 0 signals → healthy
- 1–2 signals → consolidation recommended (warning)
- 3+ signals → garbage collection mandatory (error)

## Root State Split Details

The validator prefers the organic ABC standard but stays compatible with inherited aliases.

- `BACKLOG.md` passes as the preferred canonical open-work file
- `TODO.md`, `PLAN.md`, and `ROADMAP.md` are accepted as fallback aliases with a warning
- `CHANGELOG.md` is expected for completed delivery history
- If `AGENTS.md` still contains a `Change History` section while `CHANGELOG.md` exists, the validator warns about state duplication

## README Reachability Details

The validator treats subtree `README.md` files as human entrypoints, not decorative files.

- Root `README.md` is exempt from inbound-link checks
- A subtree `README.md` should be linked from at least one other markdown file
- Zero inbound markdown links usually means the entrypoint is isolated and likely stale or undiscoverable

## Link Validation Details

- Parses markdown link patterns from files
- Skips links inside fenced code blocks
- Handles anchor-only links, file links, and file+anchor links
- Supports GitHub-style line references (`#L10`, `#L10-L20`)
- Converts headings to GitHub-style anchors for validation
- Reports file path and line number for each broken link
- Scans all `.md` files under project root, excluding common generated/vendor paths
- Uses UTF-8 locale when available, with safe `C` fallback

## Usage

```bash
# From project root (human-readable)
bash /path/to/skill/scripts/validate-context

# Machine-readable JSON output
bash /path/to/skill/scripts/validate-context --json

# With custom project root
VALIDATE_CONTEXT_ROOT=/path/to/project bash /path/to/skill/scripts/validate-context
```

## Exit Codes

- `0` — all checks passed (warnings are acceptable)
- `1` — one or more errors detected, manual intervention required

## Related

- [SKILL.md](../SKILL.md) — full protocol specification
- [templates.md](./templates.md) — entry templates referenced during post-task protocol
