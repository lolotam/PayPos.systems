# Debate 45-ui — one round

Reviewer: pospay-advisor (Fable) — PP-112 fallback

Astra (`gpt-6-astra`) is out of quota until 2026-11-14 11:20, so the one round ran on the read-only `pospay-advisor`
(PP-112 fallback). Advice is non-binding (PP-136). Reviewed: `plan-45-ui.md`, spec row 45, FR-071, CP-01, the detail
query, the contract and the migration that creates `package_extensions`. Verdict by the advisor: agree with changes.

| # | Sev | Finding | Verdict |
| --- | --- | --- | --- |
| 1 | P1 | "Any 4xx is terminal" in D4 is wrong: 409 `IDEMPOTENCY_KEY_IN_PROGRESS`, 401, 408, 429 must keep the key; list terminal codes explicitly, reuse the `use-save-attempt-key.ts` pattern, test it | Accepted: plan D4 and both briefs |
| 2 | P1 | D3 (expected date fixed at open) contradicts D5 (stale 409): on `PACKAGE_EXPIRY_STALE` take the refetched `expires_on`, mint a new key, reset `min`, re-validate, block submit if the refetch fails | Accepted |
| 3 | P1 | A background refetch must not change the CAS date under an open form: snapshot `expected_expires_on` in form state, change it only via the stale path | Accepted |
| 4 | P1 | D6 ships an unreachable dialog; manager decides; do not mark row 45 done on the roadmap; a capability source may exist in the admin (`attendance-request-capabilities`) | Accepted as a manager decision (report open question 1); this session does not touch `roadmap.json` |
| 5 | P2 | The `EXPLAIN` assertion may pick the rival unique index or a seq scan on a tiny table; predicate must carry company, business, entitlement; seed enough rows | Accepted (test brief) |
| 6 | P2 | Isolation test is cross-company only; add same-company other entitlement and other-business cases | Accepted |
| 7 | P2 | `DESC` sort on an `ASC` index: cover equal `extended_at` and the `id` tie-break | Accepted |
| 8 | P2 | Use the same UTC `to_char` pattern as redemptions and `YYYY-MM-DD` dates | Accepted (already in brief) |
| 9 | P2 | "Expiry + 1 day" must be calendar-string arithmetic in `model/`, never a local-timezone `Date` | Accepted |
| 10 | P2 | Client reason rule must match the server (trim space/tab/CR/LF, count code points); send one consistent form since the body feeds the fingerprint | Accepted: the trimmed reason is what is sent |
| 11 | P2 | Double submit: disable on `isPending` and a synchronous ref guard; test two clicks in one tick | Accepted |
| 12 | P2 | A 403 must also disable submit, not only show a message | Accepted |
| 13 | P3 | Assert the exact key set in the SQL shape test, not only through the strict parse | Accepted |
| 14 | P3 | Update the Arabic JSDoc of the statement; add the schema to `customerPackageSchemas`; extend the two existing specs of the detail query | Accepted |
| 15 | P3 | D2 (no reason, no `extended_by`) is right and is a feature question for the page | Accepted: `owner-questions.ar.md` 45-UI-Q1 (PENDING) |
| 16 | P3 | Stacking: retarget before `--delete-branch`; say "the migration that creates `package_extensions`" instead of a number (PP-130) | Accepted: passed to the manager in the report |
