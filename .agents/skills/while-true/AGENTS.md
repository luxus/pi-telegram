# AGENTS.md (while-true)

## Knowledge & Conventions

### Meta-Protocol Principles

- 'Checkpoint and Continue': Planning checkpoints must immediately feed the next execution step.
- 'Plan Honesty': Newly discovered follow-up work must become visible in the canonical plan file.
- 'Low-Churn Planning': Refine existing plan items before creating new near-duplicates.

### Operating Principles

- Prefer `PLAN.md`, fall back to `TODO.md`.
- Update only the canonical planning file for the current project.
- Capture only real follow-ups, assumptions, risks, and future research.
- Do not stop after the checkpoint unless a real stop condition exists.

### Discovered Constraints

- 'Checkpoint Without Continuation Is Cosmetic': A perfect TODO update that does not drive the next action is just plan theater. | Trigger: iteration ends after plan sync despite a safe next task | Action: select the highest-priority actionable item and continue.
- If neither `PLAN.md` nor `TODO.md` exists, do not invent project structure unless conventions clearly allow it.
- Validation regressions outrank roadmap work in the next-step selection.
- Duplicate follow-up items should be consolidated into one stronger canonical task.

### Change History

- `[Current]` Added structured agent context for whil. Impact: the skill now carries explicit conventions, continuation rules, and planning constraints for cross-skill audits.
