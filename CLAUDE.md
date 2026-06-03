# Project

<!--
  Paste this block into the project's CLAUDE.md (init-project.mjs appends it
  automatically). It is the behavioral contract. It deliberately does NOT
  contain the taxonomy — that lives in .ai/config.yml so it stays flexible.
-->

## Workflow contract (.ai/)

The taxonomy, routing, priorities, statuses, and drain rules are defined in
`.ai/config.yml`. **Read it at session start; it is the source of truth.** This
contract is the meta-behavior around it.

### Interjections — default is CAPTURE, not STEER
When Chris says something while I am working, the default is: **route it to the
right place and keep working.** Blocking is the exception, not the rule.

For each interjection I:
1. **Classify** it against `.ai/config.yml` → `classifications`.
2. **Route** it to that type's `routes_to` destination, creating/appending the
   artifact (ticket, question, note, decision, or the active ticket).
3. **Receipt**: per `config.receipts`, emit one line so a misroute is caught in
   three words — e.g. `→ BUG-024 logged (high), still on T-001`.
4. **Continue** the current task.

**Block only when** the classification's `blocking` rule fires:
- `always` (e.g. scope-change on the active ticket),
- `when-touching-active` and the input concerns the file/area I am editing now,
- `when-caused-by-active` and it is a regression from my current change,
- or Chris explicitly says stop / "this matters now".

Chris overrides either way at any time: "just log it" forces deferral; "stop"
forces a block. If classification is ambiguous, pick the best fit, state it in
the receipt, and continue — do not halt to ask.

### Draining the queue (so "later" happens without being asked)
- **Between tickets**: when the active ticket hits `review`, pull the next item
  per `config.drain` (roadmap order if a current milestone exists, else type
  `order` + priority). If `auto_execute: within-patterns-low-risk` and the item
  is low-risk and pattern-following, start it; otherwise surface one line:
  `next up: T-007 (your call — touches UX)`.
- **Questions**: answer the ones resolvable from code or `.ai/DECISIONS.md`
  immediately and log the answer; batch genuinely Chris-only questions for a
  natural break rather than interrupting.
- **Regressions**: priority-bumped per config; surface proactively.
- **Anti-relitigation**: if an interjection reopens a point already in
  `.ai/DECISIONS.md`, cite it in one line ("settled 2026-05-30: X because Y —
  still holds?") instead of re-debating. Settled stays settled.

### Working a ticket
On "work T-001" (or when I pull it from the drain):
1. Read `.ai/tickets/T-001*.md`; **restate the acceptance criteria**.
2. **Confirm scope before editing files** (Chris's standing rule). Within an
   already-approved ticket, proceed through the plan without re-asking per file.
3. Set `status: doing`. Mirror each acceptance criterion into the native task
   list as a task titled `T-NNN <criterion>` (TaskCreate, with blockedBy for
   ordering) — the prefix marks it as ticket-backed. **The ticket file is truth;**
   the native list is a live projection kept in lockstep (see Native task sync).
4. As each criterion is satisfied, check its box `[x]` and append a `## History`
   line. Log every status change, comment, decision, and blocker there **as it
   happens** (append-only — never edit a prior line): it's the task's audit trail.
5. When all criteria pass: set `status: review`, record `(fixed) <sha>` + the
   `fixed_commit` frontmatter in History, stop, summarize the diff.
6. Chris sets `status: done` after merge (a `statuses.human_only` status — **never
   set it myself**). On done, the ticket moves to `.ai/tickets/archive/`.

### Backlog vs roadmap
- **Backlog** = tickets with `status: todo` and no `milestone`. Everything
  captured lands here first.
- **Roadmap** (`.ai/ROADMAP.md`) = sequenced milestones. Scheduling a ticket
  means giving it a `milestone`. When a current milestone exists, the drain
  works it in order before pulling loose backlog.

### Session memory (anti-amnesia)
- `.ai/SESSION.md` is working memory. After any meaningful step, update its
  current state + next 3 steps. Keep it to one screen — overwrite stale content.
- Record exact commands, error text, paths, and version pins **verbatim** in
  SESSION.md. Never trust these to survive in chat (compaction paraphrases).
- Append design choices to `.ai/DECISIONS.md` (decided / rejected / why).
- **Before any /compact or /clear, flush SESSION.md first.**
- Prefer subagents for codebase search; pass pointers (path + line range), not
  whole-file dumps, to keep the main thread lean.

### Native task sync (.ai/ ↔ native list)
The native task list is a **live, bidirectional projection** of the tickets — the
ticket file stays the durable truth (native tasks are per-session + machine-local).
Config: `.ai/config.yml` → `native_task_sync`. Because I am the only writer of native
tasks, keeping both in lockstep IS the sync:
- **Hydrate on start:** rebuild the native list from the active ticket(s) at session /
  `/work` start — `node <kit>/scripts/sync-tasks.mjs` emits the task spec from
  `.ai/tickets/`. (Native tasks don't survive the session; the ticket does.)
- **Lockstep:** when a ticket's status or a criterion changes, update the matching
  native task in the same step — and write any native status change back to the ticket.
- **Prefix:** every ticket-backed native task is titled `T-NNN …` so it's visibly
  distinct from ad-hoc tasks. Status maps per `native_task_sync.status_map`.
- **Promote orphans:** a native task with no `T-` prefix is unpersisted work — capture
  it to `.ai/INBOX.md` (per `promote_orphans_to`), then re-title the native task with
  the id triage assigns. Nothing important is left living only in the ephemeral list.

### History & regression tracking
- **Every ticket** keeps an append-only `## History` (timestamped events:
  `status | comment | decision | blocker | unblocked | fixed | regressed`, per
  `config.history.events`). Never edit or delete a prior line — it's the audit trail.
  Cross-cutting decisions also go in `.ai/DECISIONS.md`.
- **A recurring bug is a `regression` ticket, not a reopen:** set `regressed_from:
  <original id>` and `causing_commit:`; add a `(regressed) → T-NNN` line to the
  original's History. Repeat offenders surface in the generated regression index.
- **Reference files are generated, never the truth:** after a status/regression change
  run `node <kit>/scripts/index-tickets.mjs` to rebuild `.ai/tickets/INDEX.md` (the
  board), `.ai/REGRESSIONS.md` (chains), and `.ai/ROADMAP.md` (thin sequence, when
  `roadmap_mode: generated`) from the ticket frontmatter.

### Where items live (atomic — D-009)
Every category of items is a **folder of one-file-per-item**, like `tickets/`: never a
monolith file.
- `tickets/` (+ `archive/`) · `decisions/` (DEC-NNN.md) · `questions/` (Q-NNN.md) ·
  `notes/` (N-NNN.md) · `inbox/` (one file per raw capture; `cap` writes here; triage
  promotes each into the others and deletes it).
- Singletons stay single: `config.yml`, `SESSION.md`.
- **Generated views (don't hand-edit):** `tickets/INDEX.md`, `REGRESSIONS.md`,
  `ROADMAP.md` (in generated mode) — all rebuilt from the folders by `index-tickets.mjs`.
- Routing a captured item = create the atomic file in the right folder (per
  `config.yml` `routes_to`), then regenerate the views.
