# Project Backlog

_This backlog tracks only open release-relevant work: hotfixes, live runtime verification, evidence-gated Telegram client follow-ups, and upstream Pi API blockers. Completed outcomes and validation evidence belong in `CHANGELOG.md`, not in this queue._

## P0 — Termux-Compatible Filesystem Transactions (`0.22.1`)

Context: issue #131 proves that Android/Termux rejects the hard-link publication used by the `0.22.0` transaction guard, causing Pi to exit during JSONL initialization. A direct file-rename fallback is unsafe because rename replaces an existing destination and can admit multiple transaction owners. The hotfix keeps per-resource serialization but publishes a fully initialized, non-empty guard directory atomically.

Open work:

- [x] Replace staged-file/hard-link publication with a staged guard directory containing one private generation-specific owner file, then atomically rename that non-empty directory to the stable per-resource transaction path.
- [x] Keep collision-resistant owner generation plus PID and acquisition time, exact-owner verification, serialized stale recovery, and fail-closed malformed-guard behavior.
- [x] Release guards by exact-owner atomic rename away from the stable path before recursive cleanup; support stale legacy file guards left by `0.22.0` during upgrade.
- [x] Ensure JSONL append/rotation transaction failures remain diagnostics-only and cannot produce an unhandled rejection that terminates Pi.
- [x] Add deterministic regressions for directory publication, exact release, legacy and directory stale recovery, malformed guards, simultaneous acquisition, concurrent recovery, and swallowed diagnostics failures.
- [x] Update lock/diagnostics documentation and durable transaction contracts for the staged-directory protocol and fail-soft JSONL behavior.
- [x] Run implementation tests, typecheck, strict Domain DAG, ABCd, audit, package dry-run, invariants, and `git diff --check`.
- [x] Run an independent four-lens concurrency/filesystem review of directory publication, contention classification, stale recovery, exact release, legacy migration, and diagnostics containment; preserve its `NOT READY` evidence for the reproduced abandoned-recovery-guard deadlock.
- [x] Replace directory stale recovery with an internal exact reclaim marker that remains recoverable after claimant death; preserve live recovery guards and recover abandoned new-directory and legacy-file recovery guards with deterministic regressions.
- [x] Prove fail-soft diagnostics in a child process that emits one failing record under `--unhandled-rejections=strict`, independently from later queue recovery.
- [x] Run a clean follow-up review and preserve its `NOT READY` evidence for the reproduced same-process reclaim stall after a transient guard-rename failure.
- [x] Retry transient reclaim renames, roll the exact marker back on exhaustion, and treat inactive process-global reclaim generations as recoverable even when rollback itself fails; cover same-process reacquisition in both cases.
- [x] Run a final four-lens review and preserve its `NOT READY` evidence for peer-visible marker starvation and leaked replacement ownership after failed abandoned-recovery cleanup.
- [x] Retry rollback renames for peer-visible recovery, release exact newly recovered main ownership when secondary cleanup fails, and cover both failure sequences with deterministic same-process and child-process regressions.
- [x] Run one bounded final reviewer and preserve its `NOT READY` evidence for a reproduced stale-observation ABA race that let a delayed recoverer claim a replacement generation.
- [x] Bind each new directory owner generation into its unique `owner.<generation>.json` path and require filename/payload generation agreement, so delayed recovery receives `ENOENT` instead of renaming replacement metadata; cover the exact interleaving and repeat the child-process recovery barrier 20 times.
- [x] Obtain a final clean `READY` verdict and resolve every remaining release-blocking local finding.
- [x] Prepare `0.22.1` version metadata after review readiness, then rerun the complete release gate against the final package contents.
- [ ] Ask the issue #131 reporter to verify Termux startup, config/log writes, `/telegram-connect`, and reload after the hotfix becomes available; retain this as post-release environment evidence rather than a local release blocker.

Done when: pure Node filesystem operations provide exactly-one transaction ownership without hard links; old, replacement, and failed-recovery owners cannot delete or strand each other's guards; diagnostics failures cannot terminate Pi; independent review returns local `READY`; final release gates pass; and the post-release Termux verification request remains explicit until reporter evidence arrives.

## P1 — Promoted Follower Reload Evidence

Context: deterministic coverage protects promoted follower thread preservation, and the latest live Linux smoke closed reload routing, follower Active, and reroute/restore regressions. The exact promoted-leader reload path is deliberately outside the 0.20.1 profile IPC hotfix because it is unrelated to profile transport isolation; keep it as an evidence-gated follow-up rather than blocking that release.

Open work:

- [ ] Capture live evidence that leader → follower promotes → `/reload` preserves the promoted leader's Telegram thread identity.

Done when: promoted-follower reload identity has direct live Telegram evidence.

## P1 — Native Windows Threaded Mode Follow-Ups

Context: Native Windows smoke on the WIP `dev` build now passes for classic mode, classic ownership handoff, hot upgrade to Threaded Mode, leader/follower registration and delivery, and hot downgrade back to classic with follower disconnect. The observed downgrade status convergence can take around 10 seconds, which is acceptable for the current retry-based safety model but should remain evidence-gated if it becomes user-visible friction.

Open work:

- [ ] Capture text diagnostics if Windows classic restore/status convergence repeatedly exceeds the intended 5–15 second fallback window.
- [ ] Add a focused regression or transport/status adjustment only if new Windows evidence shows a repeatable named-pipe, lock, heartbeat, queue, or status-convergence issue.
- [ ] For every Windows connect/runtime crash report, classify the failing boundary (`locks.json` atomic write, named pipe, heartbeat, polling, queue, or status), ensure `logs.jsonl` captures enough redacted evidence before shutdown, and add a minimized regression when the failure can be simulated deterministically.

Done when: new Windows-specific runtime issues are either fixed with targeted coverage or left out of the backlog because the native smoke remains green.

## P1 — Evidence-Backed Telegram Client Follow-Ups

Context: The release should avoid speculative live-test matrices. Future Telegram-client quirks should be handled only when there is concrete evidence or a minimized fixture.

Open work:

- [ ] Capture any new Telegram client or Bot API behavior that contradicts the documented Threaded Mode contract, including a live local/autonomous `…typing` observation when convenient.
- [ ] Add a focused regression or documented client caveat only for confirmed behavior.
- [ ] Keep one-off live environment names, thread names, and operator-specific observations out of repository context unless they demonstrate a general product issue.

Done when: new client quirks are either fixed with targeted coverage or documented as evidence-backed exceptions, without keeping broad manual smoke matrices in the backlog.

## P1 — Evidence-Backed Rich Markdown Normalization

Context: Native Rich Markdown is the default assistant delivery path. Existing regressions cover known parser/client edges such as space-after-marker blockquotes, dollar-prefixed ticker atoms, list indentation, code fences, links, display math normalization, and long-message splitting. Further rewrites should be evidence-driven, not speculative.

Open work:

- [ ] Capture any new Telegram parser-breaking sequence from live/client evidence or a minimized fixture.
- [ ] Add a conservative normalization or safe-degradation rule only for confirmed sequences.
- [ ] Keep unconfirmed speculative rewrites out of the delivery path.

Done when: newly observed Rich Markdown failures have minimized fixtures and targeted regressions, while stable rendering behavior remains unchanged for unsupported guesses.

## Blocked — Same-Thread Telegram `/new`

Blocked: upstream Pi core API. Issue: https://github.com/earendil-works/pi/issues/5952

Context: Threaded Mode manual followers are separate visible Pi processes. Same-thread `/new` is a different feature: replacing the current Pi session inside the same Telegram thread. Extension-only hacks are rejected because they would desynchronize Pi lifecycle/TUI semantics.

Current upstream evidence: Pi 0.80.6 safely exposes `ctx.newSession()` to registered extension commands through `ExtensionCommandContext`, including fresh-context rebinding after replacement. Telegram update and callback handlers still receive only `ExtensionContext`, and extension-origin `pi.sendUserMessage()` deliberately disables slash-command handling. The upstream maintainer described an async extension bridge as potentially possible after the current refactor, but no supported API exists yet.

Required upstream shape:

- `pi.newSession(...)` or `pi.requestSessionReplacement(...)` callable from trusted extension runtime code.
- Must use the same session-replacement path as the terminal command, including normal `session_shutdown` / `session_start` lifecycle.

Constraints:

- Do not store stale `ExtensionCommandContext`.
- Do not inject TUI input.
- Do not spawn a shadow `pi` subprocess.
- Do not mutate session files directly.
- Do not route through `pi.exec`; it is shell execution, not a Pi slash-command dispatcher.

Done when: `/new` in the current Telegram thread performs an official same-instance session replacement, preserves the thread binding, rebinds after lifecycle restart, reports success/cancellation in the same thread, and has regressions for active turns, pending Pi messages, queue state, preview cleanup, cancellation, failure, and success.
