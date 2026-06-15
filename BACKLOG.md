# Project Backlog

- [ ] Track a public Pi session-replacement hook before adding Telegram `/new`.
  - [ ] Wait for a safe public Pi API.
    - Done when: Pi exposes an API that invokes the same session-replacement path as terminal `/new`.
    - Done when: the API covers lifecycle, active-run handling, and TUI rerender semantics.
  - [x] Keep unsafe implementation routes rejected.
    - Done when: raw TTY injection remains rejected.
    - Done when: ANSI terminal clearing remains rejected.
    - Done when: private TUI container mutation remains rejected.
    - Done when: shadow `pi` subprocess control remains rejected.
