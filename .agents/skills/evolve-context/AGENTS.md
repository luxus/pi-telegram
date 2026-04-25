# AGENTS.md (evolve-context)

## Knowledge & Conventions

### Meta-Protocol Principles

- 'Self-Reference': This skill must validate its own documentation using its own scripts.
- 'Root State Separation': Durable protocol belongs in `AGENTS.md`, open work belongs in `BACKLOG.md`, and completed delivery belongs in `CHANGELOG.md`.
- 'Hybrid Context Coverage': The protocol serves ABC + README entrypoints + `/docs` as one coordinated context graph.
- 'Cross-Platform': Scripts must support both Linux and MacOS.
- 'Self-Enhancement': Protocols anticipate and facilitate their own evolution.
- 'Workflow Stratification': Preparation → execution → reflection → documentation.

### Operating Principles

- Use `validate-context` for all documentation audits.
- Use `scripts/_self-test` to verify skill integrity after changes.
- Prefer the ABC root control plane: `README.md` + `AGENTS.md` + `BACKLOG.md` + `CHANGELOG.md`, with subtree `README.md` files as human entrypoints and `docs/README.md` + `/docs` as the knowledge plane.
- SKILL.md stays compact; `docs/protocols.md` contains only what SKILL.md does not.
- `BACKLOG.md` keeps only remaining open, gated, or blocked work; close or narrow items in the same pass that changed reality.
- `CHANGELOG.md` tracks completed delivery history; `AGENTS.md` should not accumulate per-iteration delivery logs when `CHANGELOG.md` exists.
- Keep root `README.md` connected to `AGENTS.md`, `BACKLOG.md`, `CHANGELOG.md`, and `docs/README.md`.
- Keep subtree `README.md` files reachable from parent/root/docs navigation once they become real human entrypoints.

### Discovered Constraints

- 'Farmville Trap': If the protocol generates more documentation updates than actually prevented mistakes, it has become a Tool Shaped Object. Measure value by errors avoided, not files touched. | Trigger: Post-task protocol fires but produces no actionable insight | Action: Skip the update. Silence is a valid output.
- 'Progressive Disclosure over Always-On': ALWAYS_ON mode costs agent attention on every turn even when irrelevant. Prefer POST_TASK as default. | Trigger: Agent tracking overhead exceeds insight value | Action: Default to POST_TASK; use ALWAYS_ON only when explicitly requested.
- 'A2 applies to templates': Context templates must start minimal — imposing principles and ceremony on a new project violates Axiom A2. Template is a skeleton that grows with the project, not a manifesto.
- 'Self-contradiction kills trust': Absolute rules must survive contact with every other rule in the system. "Mandatory" + "skip if empty" is a contradiction — use conditional language.
- 'Durable/open/completed state must not collapse': If the same reality is tracked simultaneously in `AGENTS.md`, `BACKLOG.md`, and `CHANGELOG.md`, the protocol loses truthfulness. Route each fact to exactly one root file.
- 'README tree is part of context, not decoration': Root and subtree `README.md` files are human-facing entrypoints and must be updated when setup, usage, topology, or same-domain insight truth changes.
- 'Per-iteration delivery history belongs in CHANGELOG': Once a project keeps `CHANGELOG.md`, `AGENTS.md` should store reusable constraints, not rolling delivery bullets.
- 'Minimal starter != permanent ceiling': Minimal AGENTS templates are acceptable for early projects, but mature repositories should grow a layered hierarchy when constraints justify it.
- 'LLM YAML tracking is fictional': LLMs reason in natural language, not structured YAML. Tracking schemas in prompts create illusion of process. Post-task evaluation does the actual work.
- 'Ceremonial formalization': If pseudocode describes what an experienced developer would do by default, the formalization adds no value. Formalize only non-obvious protocols.
- `stat` command differs between Linux (`-c %Y`) and MacOS (`-f %m`).
- `grep -P` is unavailable on macOS BSD grep — use `grep -oE` + `sed` instead.
- `heading_to_anchor` must preserve underscores `_` to match GitHub's anchor generation.
- `[[ cond ]] && action` in a function with `set -e` exits on false — use `if/fi` or `|| true`.
- `\$[^$]+\$` regex false-positives on shell variables — check for LaTeX commands specifically.
- "Core structure" check now accepts both `## 1.` project sections and skill-style key sections.
- Scripts use no file extension — shebangs (`#!/usr/bin/env bash`) define the interpreter.
- `realpath --relative-to` is GNU-specific — prefer path-prefix stripping for docs-relative paths.
- UTF-8 locales differ by platform (`en_US.UTF-8`, `C.UTF-8`, `C.utf8`) — include safe `C` fallback.
