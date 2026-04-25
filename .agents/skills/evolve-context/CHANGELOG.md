# Changelog

## 1.3.0

- Replaced placeholder meta-protocol headings in the `AGENTS.md` templates with concrete principle sets so new and restructured projects start with an actual governing philosophy rather than empty scaffolding.
- Clarified in the protocol docs that meta-protocol sections should be instantiated, not left as symbolic placeholders.
- Clarified that `evolve-context` should not only scaffold new projects but also restructure existing context files toward the chosen template when the current shape is too flat or mixed-level.
- Added explicit meta-protocol principles to the lean `AGENTS.md` starter so both template tracks explain how context itself should evolve.
- Split the `AGENTS.md` starter guidance into two explicit tracks: a lean starter for small projects and a layered mature-project starter for repositories that need a protocol hierarchy closer to evolved systems like `tmctol`.
- Clarified in the protocol docs that template choice should follow real project maturity instead of forcing either minimalism or heavy structure by default.
- Expanded the skill from an ABC-only correction pass into a hybrid context reconciler that explicitly serves `ABC + README tree + /docs`.
- Elevated root and subtree `README.md` files to first-class managed targets in the protocol, templates, and validation design.
- Extended `validate-context` and `_self-test` to treat README reachability as part of context health instead of auditing only root files and docs.
- Re-expanded the AGENTS starter guidance from minimal-only toward a layered mature-project structure modeled on evolved repositories, and made same-domain README insight refresh an explicit completion expectation.
- Reframed the skill around the organic ABC root standard: `AGENTS.md` now owns durable protocol, `BACKLOG.md` owns open work, and `CHANGELOG.md` owns completed delivery history.
- Removed the old expectation that `AGENTS.md` should carry rolling Change History entries and updated the docs/templates/validator to prefer root-state separation instead.
- Added a first-class `BACKLOG.md` to the skill itself, updated README connectivity to expose the full root control plane, and expanded self-tests around the ABC split.

## 1.0.0

- Structural cleanup: protocols.md 261→90 lines, removed Session Initialization ceremony, During-Task YAML tracking, Post-Task Protocol Full (now inline in SKILL.md)
- Context Template made minimal and A2-aligned: removed 9 Meta-Protocol Principles, Pre/Post-Task protocols from template
- Full post-task steps inlined in SKILL.md (no external link dependency)
- Index file naming: `AGENTS.md` primary, alternatives listed as fallback
- Added discovered constraints: A2-templates, self-contradiction, LLM YAML fiction, ceremonial formalization
- protocols.md now contains only delta: adaptation rules, lifecycle management, validation checklist

## 0.4.0

- Added self-test script (32 assertions)
- Fixed "Core structure sections missing" false positive for skill AGENTS.md
- Core structure check now accepts both `## 1.` and skill-style key sections

## 0.3.0

- Major refactor: SKILL.md compressed from 573 to 161 lines
- Detailed protocols extracted to `docs/protocols.md`
- Introduced light/full post-task protocol tiers (3 vs 8 steps)
- Added `--json` output mode to `validate-context`
- Fixed `grep -P` → `grep -oE` for macOS compatibility
- Fixed `heading_to_anchor` to preserve underscores (GitHub compat)
- Fixed LaTeX detection false positives on shell variables like `$HOME`
- Added ERR trap for runtime crash diagnostics
- Added `docs/protocols.md` — full protocol specifications

## 0.2.0

- Three-layer architecture (README → Index → Docs)
- `validate-context` with 10+ checks
- Bloat analysis with heuristic signals
- Entry templates extracted to `docs/templates.md`
- Anchor validation for GitHub-style headings

## 0.1.0

- Initial release of the Context Evolution Protocol skill
