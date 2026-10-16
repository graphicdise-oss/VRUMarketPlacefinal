# Thai province/district/subdistrict reference data (#46)

**Source**: [`kongvut/thai-province-data`](https://github.com/kongvut/thai-province-data)
**Files fetched**: `api/latest/province.json`, `api/latest/district.json`, `api/latest/sub_district.json`
**Fetched**: 2026-09-14, from the `master` branch
**License**: MIT — full text in `LICENSE-upstream`, copyright (c) 2025 Kongvut Sangkla

Vendored here (rather than downloaded at build time) so the exact bytes this migration was
generated from are reproducible and reviewable, and so the app never depends on a third-party
repository being reachable at deploy time.

## What this ticket found

The upstream schema stores one `zip_code` per subdistrict record — checked directly (see
`generate-migration-sql.ts`'s own comment), not assumed. Every one of the 7,452 subdistricts in
this snapshot has exactly one postal code. `docs/DECISIONS.md` records this finding; the schema
(`SubdistrictPostalCode` as a child table, not a column) does not assume it stays that way, per
this ticket's own acceptance criteria.

## Updating when a district or subdistrict boundary changes

**Do not edit the vendored JSON files above, and do not edit the migration this data produced.**
Migrations already run are never edited (CLAUDE.md). To bring in an administrative change:

1. Fetch the new upstream JSON files and replace the ones in this directory (this is the one and
   only case where these vendored files change — a real update, not a correction).
2. Update this README's "Fetched" date and re-check the license file has not changed.
3. Re-run `generate-migration-sql.ts` against a **new** `prisma migrate dev --create-only`
   migration — never against an already-applied one.
4. The generator diffs by `sourceCode` (the upstream numeric id), not by Thai name, so a rename
   is an `UPDATE` and a genuinely new area is an `INSERT` — but the first version of this
   generator only ever produces `INSERT`s for an empty table. Handling an in-place update
   correctly (without breaking `Address` rows that already reference the old name) is a design
   question for whoever does the first real re-import, not something to guess at now.
