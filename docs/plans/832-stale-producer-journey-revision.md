# #832: genuinely stale producer-journey revisions

Status: manager source handoff received; initial MiniMax candidate reviewed and focused validation passed; independent code review remains pending.
Baseline: tested HEAD/base 94138d1041787e0d3af7b287744b39f7b584c4d5; original and fixed journey each passed 3/3; original PASS is baseline evidence only.

## Scope and references
- Change only apps/api/src/__tests__/commission-line-producer-journey.spec.ts and docs/plans/832-stale-producer-journey-revision.md; test quality only.
- Follow docs/specs/050-orders-record-service-session/spec-35d.md, especially revision concurrency and refusal precedence, and its owner-questions.ar.md.
- Retain repository governance, PP138/PP141/PP142 and docs/specs/0892-runbook-env-provenance.md isolation requirements.
- Maximum 140 additions plus deletions, including this plan; functions <=60 and files <=400 under existing lint conventions; no line compression.

## Acceptance and approach
- Keep record/append preparation and explicitly establish that the selected shared line initially has revision 1 and status ACTIVE.
- Add one cohesive helper in this spec to prepare and verify the active revision-two refusal baseline, keeping the test callback within its function limit.
- Make exactly one authorized owner HTTP PATCH with a fresh idempotency key, valid reason, expected_revision 1, price 27.001 and AMOUNT discount 0.000.
- Require HTTP 200, parse editServiceLineResponseFull, and assert the returned selected line identity, revision 2 and ACTIVE status.
- Verify the genuine saved ServiceLineChanged event targets that line at revision 2/ACTIVE; consume original saved record/append/edit events using existing helpers.
- Capture producer and projection baselines only after delivery; assert the selected persisted line and projected head both have revision 2/ACTIVE.
- Change only the stale variant's revision from 9 to 1; explicitly assert each stale request's revision is below the observed current revision.
- PATCH price, PUT performers and POST cancellation must return 409 SESSION_LINE_REVISION_STALE with details.current_revision equal to the observed revision 2; each expected_revision 1 must be below it.
- Preserve all other bodies, cookies, companies, URLs and negative revisions, including unauthorized and foreign-scope 403 precedence.
- Keep refused PATCH price 27.001: assertLineEditable precedes prepareLineEdit, so stale revision wins before SESSION_EDIT_NO_CHANGE.
- After every refusal, retain complete producer outbox/line/history and projection heads/rows/consumption-marker equality assertions.
- Preserve RLS role and foreign-row assertions and existing happy-path/replay coverage; never use changeJourney for preparation or weaken assertions, retries or timeouts.

## Evidence and validation
- Baseline evidence is the static revision-9-versus-revision-1 mismatch; a passing original test would not reproduce its missing older-revision assertion.
- Fixed evidence requires the real 1-to-2 transition and all three revision-1 refusals; record actual results only after execution, with no fabricated PASS.
- At resource readiness, recheck newer manager claims/load, perform this checkout's frozen install and build necessary API/worker dependencies.
- Review unchanged globalSetup, the API harness, pg-env, lane helper and this checkout's tracked dev template before setup; the focused journey requires private owned loopback PostgreSQL and Redis.
- Generate fresh local credentials with exclusive-create/provenance checks; never copy env/secrets, use shared 5432/6379, or change tracked configuration.
- Run the focused journey spec, API typecheck, scoped lint, docs, boundaries, module-map, format and diff checks; heavy/full/E2E remain CI-only; release resources promptly.

## Review, delivery and budget
- This planner is not PP136 or independent design advice; obtain fresh independent advice and any required separate design review before one manager personal package review.
- Source stays blocked until explicit manager handoff; initial test authorship remains acpRegistry_minimax_code / m:minimax:MiniMax-M3.1-Flash:v:thinking.
- Require fresh independent Astra/high code review before one PR in the original parent session; preserve external five-review and exact-head CI gates.
- Preserve freshness, applicable verified backup and verified restore, coordinated merge order and resource gates; the prior #903/#904 receipt is not automatic coverage.
- After formatting, measured test additions/deletions are 59/7 plus 40 new plan lines: 106 ALL; scoped static checks passed and owned PostgreSQL/Redis were removed.
- Notify the owning manager at completion/blocker with task/PR, exact head, actual results, remaining work and next action; this plan grants no source or resource handoff.
