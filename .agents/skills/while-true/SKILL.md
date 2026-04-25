---
name: while-true
description: Continuous execution-loop protocol — assess reality, refine the plan, execute the next task, repeat until a real stop condition is reached.
metadata:
  version: 1.2.0
---

# While True

## Purpose

A continuous planning-and-execution loop that keeps the canonical plan aligned with reality, captures every implementation insight as it emerges, chains into the next actionable task automatically, and never stalls on planning or reporting alone.

## Core Model

The loop is built around a single universal **checkpoint** operation that occurs at every boundary between execution slices:

```text
checkpoint → execute → checkpoint → execute → ... → checkpoint
    ^                                                   ^
  entry                                              terminal
```

**Checkpoint** is always the same: assess reality, refine the plan, select and start the next task.

Boundary cases:

- **Entry checkpoint** — may need to create the plan from scratch or rebuild it from repo/conversation state
- **Mid-loop checkpoint** — folds iteration insights back into the plan and continues
- **Terminal checkpoint** — no actionable work remains; the loop ends

There is no separate "pre-iteration" vs "post-iteration" protocol. Between any two execution slices, the operation is identical. The entry and terminal checkpoints cover the edges.

## Activation

Activate when at least one of:

- a meaningful iteration just finished and follow-up insight exists
- no trustworthy plan exists yet and work is expected
- the plan is materially out of sync with reality
- a task is actionable and the user expects continued autonomous execution

### Session mode

When the user explicitly activates `while-true` (`keep going`, `non-stop`, etc.), the mode persists across checkpoint summaries, progress updates, and clarification answers until:

- the user explicitly says `stop` or `pause`
- no actionable backlog items remain
- only blocked, destructive, or externally gated work remains

### Do not activate when

- the interaction is purely informational with no new tasks
- the user explicitly asks to stop
- continuing would require approval for destructive or externally sensitive actions

## Plan File Selection

Use exactly one canonical file: `BACKLOG.md`, `ROADMAP.md`, `PLAN.md`, or `TODO.md`.

- If exactly one exists — use it
- If multiple exist — use the one actively maintained for open work; do not duplicate across files
- If none exists — create one if project conventions allow; otherwise report the gap

**Reality-over-plan rule**: when the plan and repo state disagree, trust reality. Repair the plan before relying on it.

## Checkpoint Protocol

The single operation performed at every loop boundary.

### Guardrails

- Prefer targeted updates over wholesale plan rewrites
- Do not reorganize the plan cosmetically or split tasks unless it improves execution clarity
- If an existing plan item already captures the issue, refine it instead of creating a near-duplicate
- Every checkpoint must reconcile the just-executed slice back into the plan with an explicit state transition: `done` | `narrowed` | `split` | `blocked` | `deferred`
- If a task stays open after meaningful progress, rewrite it to describe the remaining work instead of leaving stale pre-iteration wording untouched
- Epics are allowed, but the currently active next slice must be represented concretely under the epic before continuing execution
- Do not leave evergreen maintenance disciplines as unchecked backlog items; move those into durable instructions or architecture/spec docs instead
- Do not re-enter planning repeatedly without execution progress — a checkpoint should be smaller than the next execution phase

### Step 1: Assess current reality

Review only the sources needed for an accurate picture: latest user request, conversation state, canonical plan file, modified files, failing tests, validation output, logs, relevant docs/specs.

Build a snapshot: what is done, in progress, broken, missing, blocked, and what obvious work should be decomposed now.

### Step 2: Extract and classify insights

Capture only material items: newly discovered tasks, missing validation/regression coverage, clarified acceptance criteria, broken surfaces, assumptions/risks, deferred follow-ups, and stale plan entries exposed by reality.

For each material item, decide both:

1. **Insight class** — `done` | `follow-up required` | `future research` | `assumption/risk`
2. **Plan effect** — `close existing` | `narrow existing` | `split existing` | `add sibling` | `defer existing` | `move to blocked/gated`

If the iteration changed the true exit criteria of the current task, that is not a note — it is a required plan edit.

### Step 3: Update the plan file

Write all unresolved items into the canonical plan file.

Rules:

- Preserve existing file structure and style
- Place items in the correct section, not a generic bucket
- Write concise but specific tasks with discovered nuance
- Mark completed items done; add new tasks immediately
- Keep research items visible but separated from implementation work
- Update the status of the item that drove the iteration before selecting the next task
- If work completed indirectly or opportunistically, still close the corresponding stale item immediately
- If an epic remains open, record the next concrete executable slice under it before continuing
- If a task was too vague to execute cleanly, decompose it now rather than carrying the same vague wording forward

Backlog sync operations:

- **Close** when the exit criteria are satisfied in reality
- **Narrow** when part of the task is done and the remainder is smaller/clearer than before
- **Split** when one vague item turned into multiple independently executable tasks
- **Retarget** when reality showed the original wording was aimed at the wrong remaining work
- **Defer** when the work remains valid but is no longer the best next slice
- **Move to blocked/gated** when the remaining work now depends on an external condition

Deduplication:

- Refine an existing entry when new insight narrows scope or adds edge cases
- Create a sibling only when work is truly separate in execution
- Consolidate synonym duplicates into one canonical item when safe
- Tighten vague items with newly discovered constraints instead of appending duplicates

### Step 4: Update in-progress documentation

Only when the iteration closed a real white spot in a design/spec doc still under active refinement. Skip stable reference docs, cosmetic edits, and insights that belong in the plan file rather than documentation.

Decompose insights into actionable new tasks and fixate them in the most appropriate documentation, prioritizing existing files (like `BACKLOG.md`, `ROADMAP.md`, or active specs) over creating new ones. Ensure that discovered nuances map directly to updated or new specific tasks rather than vague observations.

Do not use docs as a substitute for backlog state: if an insight changes what remains to be built, the plan file must still be updated even when the same nuance is also recorded in a spec or architecture doc.

### Step 5: Select and start the next task

1. Re-read the updated plan
2. Pick the highest-priority actionable task (see Priority Rules)
3. **Start executing before emitting any checkpoint report** — read relevant files, run validation, make the first edit
4. Only then emit a concise progress update if needed

If a checkpoint update is emitted, summarize the plan delta explicitly in one short line when useful: which item was closed, narrowed, split, or added.

If the highest-priority item is not actionable, skip to the next one.
If a full item is ambiguous but a safe subset is clear, execute the subset and keep the item open.

## Priority Rules

Determine priority in this order:

1. Explicit user instruction
2. Safety or correctness issues exposed by current reality
3. Project-specific canonical priority source
4. Section ordering inside the plan file
5. Default type priority (below), weighted by task size

### Default type priority

1. Correctness or safety fixes
2. Broken validation, failing tests, compile errors, doc/spec dishonesty
3. Missing implementation required by the active roadmap
4. Missing regression coverage for newly discovered invariants
5. In-progress design/spec updates closing resolved white spots
6. Deferred research with a clear safe subset

### Size-aware scheduling

When multiple tasks share the same type-priority level:

- Prefer higher effort-to-impact ratio — small effort, large impact first
- A quick fix that unblocks other work outranks a large standalone task at the same level
- If a large task can be split into an immediately valuable slice and deferred remainder, execute the slice
- If an epic has no concrete next slice yet, creating that slice in the plan is part of the checkpoint and should happen before execution continues

## Decomposition Rules

Decompose when the next work is clearly larger than one step, the plan is too vague for immediate execution, or a failure implies 2–5 concrete follow-ups.

### Canonical convergence decomposition

For open-ended improvement work, use a convergence task instead of a premature checklist. The goal is to make the task progress fractally through validated iterations and prevent early closure after one successful slice.

A convergence task must include:

- **Goal**: The durable direction of travel and the quality boundary being protected
- **Iteration loop**: A repeatable sequence such as observe → classify → execute/extract → guard invariants → validate → reconcile context → reassess
- **Candidate slices**: Concrete near-term areas to inspect, phrased as candidates rather than mandatory one-shot subtasks
- **Stop conditions**: Objective closure criteria that require reassessment, validation, and context truth, not just a completed edit
- **Non-goals**: Explicit traps to avoid, such as cosmetic churn, speculative subtrees, broad facades, hidden state, or line-count-only work

Use this pattern when the work should narrow through reality checks over multiple cycles, especially architecture convergence, refactoring, cleanup, reliability hardening, and documentation/context reconciliation. Do not mark the parent complete until its stop conditions hold in the same pass.

### General rules

- Decompose only to the depth needed for immediate clarity
- Prefer a small number of concrete siblings over one vague umbrella task
- Do not create speculative subtrees for work that is not yet real
- If only the first slice is clear, plan it and record remaining uncertainty explicitly
- When decomposing an epic, preserve the epic if useful, but always materialize the immediately executable child slice
- After decomposition, retarget the parent so it reflects the remaining umbrella scope rather than duplicating the new children verbatim
- For convergence tasks, keep the parent open and rewrite candidate slices/stop conditions as reality changes rather than carrying stale wording forward

### Task quality

Good: `Add runtime regression for dust assignment when delegator split leaves operator remainder`
Good epic + slice: epic `Governance productization in /web-client` + child `Add typed proposal-status query adapter used by proposal list/detail pages`
Bad: `Fix rewards`

## Stop Conditions

Stop only when:

- the next step is destructive or irreversible
- the next step requires secrets, credentials, or external accounts
- the user explicitly asks to stop
- remaining ambiguity blocks even a safe subset
- no actionable backlog items remain
- only blocked or externally gated work remains

If a safe subset exists, continue with that subset.

## Behavioral Axioms

1. **Reality over plan** — assess reality first; repair stale plans before relying on them
2. **Continue by default** — checkpoints are not stopping points; the loop ends only on a real stop condition
3. **Execute, don't just plan** — start work before reporting; never terminate on a planning or reporting step alone
4. **No hidden debt** — every discovered limitation, compromise, or follow-up becomes visible in the plan immediately
5. **Backlog state must move** — each meaningful iteration must leave the canonical plan more truthful: close, narrow, split, retarget, or gate something
6. **Compress, don't bloat** — capture insight in the shortest form that preserves future usefulness; prefer the smallest plan edit that preserves truth

## Loop Invariant

```text
while actionable, safe work remains:
  checkpoint (assess → refine plan → select task → start execution)
  execute a meaningful slice
  repeat
```
