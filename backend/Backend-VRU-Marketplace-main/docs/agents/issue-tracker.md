# Issue tracker: GitHub

> ไฟล์นี้บอก skill ต่างๆ ว่า "issue" ของ repo นี้อยู่ที่ไหน — `/to-spec`, `/to-tickets`, `/triage`
> และ `/wayfinder` อ่านจากไฟล์นี้ · เขียนเป็นภาษาอังกฤษเพราะชื่อ label และคำสั่งต้องตรงตัว

Issues and specs for this repo live as GitHub issues in
**`graphicdise-oss/Backend-VRU-Marketplace`**.

> The repo was renamed: the older lowercase URL still redirects, but push and API
> calls should use the capitalised name above.

## ⚠️ Which tool to use depends on where the agent is running

This repo is worked on from Claude Code remote sessions, where **the `gh` CLI is not
available** — the session is told to use the GitHub MCP server instead. Reaching for
`gh` there fails with "command not found", so check before assuming.

| Operation | Local shell / CI (`gh` present) | Claude Code remote (MCP) |
| --- | --- | --- |
| Create an issue | `gh issue create --title "..." --body "..."` | `mcp__github__issue_write` |
| Read an issue | `gh issue view <n> --comments` | `mcp__github__issue_read` |
| List issues | `gh issue list --state open --label <label>` | `mcp__github__list_issues` / `search_issues` |
| Comment | `gh issue comment <n> --body "..."` | `mcp__github__add_issue_comment` |
| Apply / remove labels | `gh issue edit <n> --add-label`/`--remove-label` | `mcp__github__issue_write` |
| Close | `gh issue close <n> --comment "..."` | `mcp__github__issue_write` (set `state_reason`) |
| Sub-issues | `gh api` on the sub-issues endpoint | `mcp__github__sub_issue_write` |

MCP tool schemas are deferred in those sessions: load them with `ToolSearch` before
calling. Infer the repo from `git remote -v`; both `gh` and the MCP tools take it
from the clone or from explicit `owner`/`repo` arguments.

**Repository scope is enforced.** A remote session is granted access to named repos
only, and calls to anything else are denied. A session opened against
`Backend-Artink` cannot file issues here until this repo is added to it — check the
session's scope before assuming a write will land.

## Conventions

- Use a heredoc for multi-line issue bodies from a shell; pass the body as a plain
  string through MCP.
- Always set `state_reason` when closing an issue.
- Search before creating, to avoid filing a duplicate.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as
feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the
`gh pr` equivalents (or `mcp__github__pull_request_read` /
`mcp__github__update_pull_request`). List open PRs and keep only an
`authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` or `NONE`; drop
`OWNER`, `MEMBER` and `COLLABORATOR`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either:
try the PR read first and fall back to the issue read.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read the issue with its comments.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: one issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far /
  Fog body.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue. Where sub-issues
  are not enabled, add the child to a task list in the map body and put
  `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>`
  (`research` / `prototype` / `grilling` / `task`). Once claimed, assign it to the
  driving dev.
- **Blocking**: GitHub's native issue dependencies, which are UI-visible. An edge is
  added with the blocker's numeric **database id**, not its `#number` or `node_id`.
  GitHub reports open blockers in `issue_dependencies_summary.blocked_by`. Where
  dependencies are unavailable, fall back to a `Blocked by: #<n>, #<n>` line at the
  top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children, drop any with an open blocker or
  an assignee; first in map order wins.
- **Claim**: assign the issue to yourself — the session's first write.
- **Resolve**: comment the answer, close the issue, then append a context pointer to
  the map's Decisions-so-far.

## Project-specific note

`docs/DECISIONS.md` is the source of truth for **what has been decided and why** —
the output of `/grill-with-docs`. GitHub issues carry **work not yet done**: the spec
from `/to-spec` and the tickets from `/to-tickets`. A decision belongs in
`DECISIONS.md`, not in an issue comment where the next session will not find it.

### What is already filed (as of 2026-09-12)

The repo still holds no code. `/grill-with-docs` and `/to-spec` are both **complete**:

- **#1** — the parent spec: shared agreements, the two test seams, the order state
  machine, and a dependency map over the twelve topics
- **#2–#13** — one spec per topic (`Spec 1/12` … `Spec 12/12`), each attached to #1 as a
  GitHub sub-issue and labelled `ready-for-agent`

`/to-tickets` has not run, so **tickets filed from here on are children of one of
#2–#13, not new top-level specs.** Search before creating: a twelve-topic spec set is
easy to duplicate by accident.

### Comments on those issues are pointers, not decisions

When a later grilling round answers something an issue flagged as "stop and ask", the
answer goes in `DECISIONS.md` and the issue gets **a comment pointing at it** (this is
how K1–K17 were recorded across all thirteen issues on 2026-09-12). The comment exists
so the next session does not re-ask a settled question — it is not where the answer
lives, and **issue bodies are left as written** so they stay a record of what the spec
looked like when it was produced.
