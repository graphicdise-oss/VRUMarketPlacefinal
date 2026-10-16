# Domain Docs

> บอก skill ว่าจะไปอ่านคำศัพท์และเหตุผลเชิงออกแบบของโปรเจคนี้ได้ที่ไหน
> เขียนเป็นภาษาอังกฤษเพราะเป็นไฟล์ที่ agent อ่าน ไม่ใช่คน

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**Layout: single-context.** One `CONTEXT.md` and one `docs/adr/` at the repo root.
There are no monorepo signals here — no workspace file, no `packages/`, no code at all
yet — so a `CONTEXT-MAP.md` would be overhead with nothing to point at.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`**: read ADRs that touch the area you're about to work in

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

Neither exists today, which is expected.

## What plays their part in the meantime

Until `CONTEXT.md` and `docs/adr/` exist, two files carry that weight and **must be
read before any spec, ticket or code**:

| File | Plays the part of |
| --- | --- |
| **`CLAUDE.md`** | the project brief: invariants, environment limits, glossary, definition of done |
| **`docs/DECISIONS.md`** | the ADR record: every decision settled in `/grill-with-docs`, with a Decision Log of deviations |

**They were reconciled on 2026-09-10 and again after every grilling round since — most
recently 2026-09-12 (K1–K17 and L1–L9).** If you ever find them disagreeing,
`DECISIONS.md` wins: it is the record of what the project owner actually answered, and
its Decision Log names each point where an answer superseded the original brief.
Don't quietly follow the losing side — say which two lines conflict.

`DECISIONS.md` is now long enough that its sections matter. The ones an agent reaches
for most: **§9** (four values locked into the schema), **§10 + L7 in §12** (the numbers
the code needs), **§11 (K1–K17)** and **§12 (L1–L9)** (everything settled while the
specs were being written). Decision codes are stable identifiers — **cite them** (`I6`,
`K14`, `L9`) in commit messages, code comments and issue comments rather than restating
the rule.

`docs/FRONTEND-NOTES.md` is a downstream summary for the frontend team, not a source of
truth. Change `DECISIONS.md` first, then propagate.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a
hypothesis, a test name), use the term exactly as the glossary defines it. Don't drift to
synonyms the glossary explicitly avoids.

**The glossary is the คำศัพท์ table in `CLAUDE.md`, as amended by the Decision Log in
`DECISIONS.md`. Read those two — this file deliberately does not restate them.**

An earlier version of this file listed the amendments inline. That made a third copy of
facts that already lived in `CLAUDE.md` and `DECISIONS.md`, and a third copy is a third
thing to forget to update — the same reason M4 refused a hand-written `api.md`. The list
was removed on 2026-09-12; if you came here looking for it, the two files above have it
and they are current.

If the concept you need isn't in the glossary, that's a signal: either you're inventing
language the project doesn't use (reconsider) or there's a real gap (note it for
`/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

The same applies to the invariants in `CLAUDE.md` and the decisions in `DECISIONS.md`:
say so and stop, rather than writing code that quietly breaks one.
