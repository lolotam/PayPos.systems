# 57b-1 dependency refresh — current receipt

2026-11-05: the historical dependency block below is resolved. The authorized F: worktree
is on `feat/p1-060-57b-1-my-attendance-api-v2`, baseline and fetched `origin/main`
`5d15dc32a02a04621c8b3ac74da804d65ba1f86f` (57-1a #845 merged).
57-1b #775, private view #784 and 57c-1 #468 are present. No stack and no migration.

`gh pr list --state open --limit 100 --json number,title,files` returned #847,
#850, #851, #852 and #853. #851 overlaps only the contract aggregators,
OpenAPI/generated clients and module map among this implementation's files.
#847 edits the shared spec's owner-question file; this slice leaves that file alone.
#850 edits process documents; #852/#853 edit CI, outside this slice.

See [57b-1-validation.md](57b-1-validation.md) for the current implementation and
validation status. The historical record is preserved below; its BLOCKED status
is historical, not the current dependency assessment.

---

# 57b-1 — dependency refresh

Date: 2026-11-05. Status: **BLOCKED — missing 57-1 own-access dependency**.

## Main and dependencies

`git fetch origin main` succeeded. HEAD and origin/main both resolve to
`cc085aacd013311f63ba7e5fffc7d98f11a6dcb2`.

The spec's 57b-1 row explicitly requires **57-1** and **57c-1 (months window)**.

- 57c-1 is merged: PR #468, commit `04a63940615abfe8666f5b0a13a3779c4fb8363a`.
- 57-1b is merged: PR #775, commit `034db9cd1b01d0d3a0f6189049f442abb81d066d`.
- 57-1c is merged: PR #784, commit `68e3e360d6d6b86e043e4d71049bc27e43065041`.
- These two private-view slices do not supply the complete 57-1 own-access dependency.
  `git grep -n 'read:attendance:own' origin/main -- packages apps` returns no matches.
  The same workspace search finds neither `read:service-sessions:own` nor
  `read:commissions:own`. ADR-0027 still explicitly leaves the four own-read
  capability addendum to 57-1. The existing own-access test covers `create:leave:own`.

Therefore the required own permission/catalog/defaults and capability authorization
are not established on main. Do not implement them as part of 57b-1.

## Open PR overlap

`gh pr list --state open --limit 100 --json number,title,headRefName,files`
returned one PR, #842 (`docs/pp124-pp125-owner-decisions`). Its files are:

- `.claude/skills/pospay-pipeline/SKILL.md`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/HANDOVER.md`
- `docs/agent-delivery-pipeline.md`
- `docs/decisions-site.md`
- `docs/owner-decisions.ar.md`

No overlap with the proposed attendance query, route, contracts, generated clients,
tests or this refresh record. PR #842 carries the pending process decisions; this
checkout's owner-decisions document currently ends at §61, not §63.

## Migration assessment

57b-1's read data already exists in `packages/db/schema/staff-attendance.ts`:
sessions (including stored lateness and current times), exceptions and corrections.
The employee/date index and correction/session index already exist. No new table,
column or index is proposed for this read-only slice. No migration is needed for
that proposed scope. The missing permission/defaults migration belongs to 57-1;
it must not be smuggled into this slice. EXPLAIN validation remains pending.

## Stop and resume

No application code, migration, database cluster, commit, push or PR was created.
No `.env` file was read. No local gates or reviews are claimed.
Initial combined mandatory-document output was truncated, so full prerequisite
reading remains required before implementation; ADR-0027 was read in full.

Resume this same session only after the manager supplies a merged own-access
dependency. Refresh main and open-PR overlap again, complete all mandatory reading,
then implement the read through `queries/`, preserving MY-Q7's corrected time plus
«اتعدّل» only and FR-A06b's personal/reception policy. Run the prescribed gates,
guards and read-only Astra medium review before the single initial PR push.
