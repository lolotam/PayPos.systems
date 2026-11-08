# #887 — Exact numeric Redis claim-state serialization

## Status and evidence
Historical PP143 scoped correctness passed 409/409 tests in eight files; this is not a fresh runtime result. Independent Astra/high CODE review and its two-line performance-proof follow-up returned APPROVE. Parent verification on 2026-11-08 refreshed worker typecheck, scoped ESLint/boundaries, formatting, lint:docs (0 errors/29 existing warnings) and module-map successfully. Fresh runtime correctness, CI performance and exact-head delivery remain pending; activation remains outside scope.
Branch fix/887-rating-counter-precision was fast-forwarded with the dirty candidate preserved to main 94138d1041787e0d3af7b287744b39f7b584c4d5; #901/#833 do not overlap this task or dependency inputs. Immutable performance baseline remains ec26930497f25213b62e2b60bc603af6b9ba3527. The coordinator's own ordered mandatory reads, completed missing ranges and current hashes are recorded separately; rejected child reads are not author evidence.
Historical reproduction: valid schema1 version 9007199254740991 reaches no-write LIMIT, but cjson emits 9.007199254741e+15 and the codec raises RATING_CLAIM_STATE_REPLY_INVALID; this planner did not reproduce it.
Static evidence: five command scripts contain ten reply/store cjson.encode sites; settle also encodes tentative state at its byte preflight. ARGV uses JSON.stringify; nested decodeState does not establish numeric identity.
Parent-supplied Redis 7.0 upstream evidence: lua_cjson.c defaults to and caps encode precision at 14; fpconv.c uses that precision. This is not evidence of the eventual private image/version; do not assume a precision-16 configuration fix.
Inference awaiting execution: 14 significant digits can silently round still-safe integers above 100000000000000; the MAX endpoint failure is only one symptom.

## Proposed bounded design
Use one internal exact JSON encoder in rating-claim-state-validate.lua.ts, shared by all five scripts; replace all eleven whole-value encode sites with this mechanism.
Place the shared fragment after MAX_SAFE and before reply definitions in every script, so reply resolves the local encoder rather than an undefined global; retain validation before load acceptance and every SET.
Retain one cjson.encode admissibility preflight per encoder invocation, discarding its text: this preserves existing type, depth and non-finite rejection behavior without changing cjson configuration; measure its additional cost.
Emit safe integral Lua numbers, including signed timestamps, as decimal JSON numeric tokens using string.format('%.0f'); use cjson for string/key escaping, booleans, null and other numeric scalars.
Traverse decoded JSON and script-created tables with an explicit stack and a fragment buffer, concatenating once; nonempty contiguous numeric-key tables are arrays, string-keyed tables are objects, and empty tables remain {}.
Preserve unknown members wherever existing commands preserve them, including nested objects/arrays, null, escaped text and numeric-looking string keys; safe integer values remain exact, other unknown numeric values retain cjson behavior.
Do not whitelist/rebuild state, mutate it during encoding, substitute sentinels, rewrite serialized text with gsub, introduce new depth/size thresholds, or change existing command-specific removal of fields.
Use the same exact output for settle's tentative byte estimate and final storage; keep tentative invalid eligibility eligible for the existing byte rollback before final validate_state, as required by #888.
Preserve schema1, numeric fields, fence/phase precedence, missing sweepOverflowCount fallback, ownership groups, retry-map semantics, page ordering, empty-table compatibility and existing LIMIT/OVERFLOW rollback behavior.
Keep codec, command wrappers, factory, context, ports and domain unchanged initially; codec-only validation cannot detect a rounded value that remains a safe integer. Exercise parse/decodeState through real replies.
Cost is linear in visited members and emitted bytes, with output-buffer and depth-stack memory; the retained cjson preflight adds a full pass. Existing accepted oversized historical input is not newly capped; prove deep/large compatibility and measure normal maximum-capacity state.
Already-rounded legacy integers cannot be reconstructed, and mixed old writers retain their defect. No repair, reset, migration, rolling-deployment remediation or activation is claimed.

## Numeric transitions and test proof
Inventory schema, reply.version, state.version, nextTicket, retry.ticket, overflowCount and optional sweepOverflowCount; versions/tickets are positive safe integers and overflow counters are nonnegative safe integers.
Preserve signed safe leaseUntil, turnStartedAt, overflowSince, retry.eligibleAt and retry.leaseUntil; retain existing safe duration validation and derived-time rejection without changing zero/negative duration policy.
Parameterize 0/1 where valid, neighbors of 2^31 and 2^32, 99999999999999/100000000000000/100000000000001, neighbors of 10^15 and 2^52, and MAX-1/MAX; include signed timestamp counterparts.
Keep fractional, negative and unsafe counter rejection; include unsafe signed timestamps and existing malformed-state controls. Seed incompatible counter/ticket combinations separately so each test reaches its intended guard.
Observe raw Lua reply, parsed codec result, persisted JSON, subsequent adapter read and the next expectedVersion fence; assert exact numeric equality and numeric token types, not merely OK or isSafeInteger.
Cover all ten commands: acquire, renew, release, begin, enrollPage, finish, reserveRetries, settlePage, settleRetry and read, using valid phase/ownership fixtures for each applicable path.
For CORRUPT and applicable BUSY/STALE/LIMIT paths, compare original Redis bytes after every call; read must also preserve bytes. Assert exact reported versions, including MAX, and preserve missing-state version-zero behavior.
Exercise each script family's successful MAX-1-to-MAX version write followed by its applicable cap refusal; preserve takeover, journal, reservation and fence state on refusal.
The automated suite retains the 18-value version vector and all ten high-version command paths. A separate small private Redis7.4.11 receipt passed all five families' MAX-1/MAX raw/codec/storage/read/next-fence transitions and no-write LIMIT; original idle-begin reproduced the baseline codec error and exact patched reply. These ten private observations are not committed automated coverage or performance proof.
Test adjacent high retry tickets in reverse map insertion order, insertion, reservation and requeue ordering; nextTicket MAX-1 allocates that ticket then reaches MAX, while MAX refuses allocation without losing journal/reservation.
Exercise capacity and byte overflow with both counters MAX-1-to-MAX, then MAX refusal; assert exactly one increment, first overflowSince preservation, reconciliation and optional historical zero fallback.
Carry positive and negative high timestamps through unrelated writes; test ownership timestamps through read/release/takeover according to their intended transitions, without inventing impossible Date values.
Cover empty retries and entries, reservations, optional absent fields, accepted unknown null/nested fields, escaped keys/text, Unicode and numeric-looking strings; known fields containing forbidden null remain CORRUPT.
Derive boundary expectations from actual exact encoded bytes, including high digits and escaped Unicode, then test equality acceptance and one-byte excess; prove insertion rollback restores nextTicket and that removal uses the full cap.
Reuse the read-only validation harness/fixtures; retain lifecycle, bytes, write-contract, invariant, corrupt, input and lease regressions unchanged in strength, including #888's unsafe-tentative-eligibility overflow rollback.
Record private-runtime version/image, baseline failure and fixed results; measure whole-command settlePage cost at 2048 retries/page 75 and near the byte cap, comparing successful ordinary-number baseline fixtures separately from high-integer correctness probes. Its estimate/store/reply can invoke the encoder three times, hence six serialization passes with per-invocation preflight.
Manager task guardrails: use equivalent freshly seeded successful ordinary-number baseline/patched states on the same private image/resources/harness; time whole commands, reseeding outside timing, with 20 warm-up and 100 measured calls per variant in alternating blocks.
Include 2048 retries/page 75, 2047-to-2048 insertion, near-cap states and applicable insertion/removal/overflow; report image/version, bytes, load, counts, median, p95 and maximum. Every patched p95 must be <= 50 ms and <= max(2 * baseline p95, baseline p95 + 5 ms); any command > 100 ms blocks acceptance pending diagnosis.
Record elapsed time for a whole 75-settlement page and retain deadline/lease/renewal/correctness checks. Maximum-capacity performance and heavy suites are CI-only; a local small probe is not this receipt.
Stop for failed thresholds, changed outcomes/bytes, insufficient valid baseline samples, unreliable timing, failed checks or missing evidence. These are task guardrails, not product SLOs or a performance PASS; no favorable-sample retries or changed fixtures/load.
Existing check failure or insufficient evidence stops delivery; do not change assertions, thresholds, timeouts or resource load to manufacture success.

## Change reservation (ALL additions plus deletions)
P below means apps/worker/src/modules/customers/persistence; every estimate includes removed/moved lines as well as additions.
| Allowed path | Estimated ALL |
| --- | ---: |
| P/rating-claim-state-validate.lua.ts | 148 |
| P/rating-claim-state-acquire.lua.ts | 6 |
| P/rating-claim-state-lease.lua.ts | 6 |
| P/rating-claim-state-reserve.lua.ts | 6 |
| P/rating-claim-state-settle.lua.ts | 8 |
| P/rating-claim-state-sweep.lua.ts | 6 |
| P/redis-rating-claim-state.codec.ts | 0 |
| P/redis-rating-claim-state.commands.ts | 0 |
| P/redis-rating-claim-state.ts | 0 |
| P/__tests__/redis-rating-claim-state.spec.ts | 0 |
| P/__tests__/rating-claim-state-numeric.spec.ts | 248 |
| P/__tests__/rating-claim-state-bytes.spec.ts | 38 |
| P/__tests__/rating-claim-state-write-contract.spec.ts | 27 |
| P/__tests__/rating-claim-state-numeric-transitions.spec.ts | 187 |
| P/__tests__/rating-claim-state-performance.spec.ts | 220 |
| docs/plans/887-rating-counter-precision.md | 100 |
| Total maximum allocation | 1000 |
Parent-measured formatted ALL after the independent P2 correction: production139/180, correctness497/500, CI performance220/220, docs98/100; total954/1000 (previous952 included the old218-line performance file). The correction adds near-cap RETRY/2047 byte overflow and persisted nextTicket verification without changing thresholds. Per-path figures above remain reservations; rejected candidates/history are preserved, with no component transfer, scope expansion or retrospective author PASS.
Manager amendment adds only the two test paths above to the original fourteen; no other writable path is proposed. Preserve readability and file/function limits; if required proof or compatibility cannot fit, stop for a manager scope/budget amendment before exceeding the allowlist or ceiling.

## Execution and gates
The planner returns this exact text and its reading receipts; the parent preserves it only at the allowed plan path.
Planning and independent advice completed in separate gpt-6-astra/high contexts. New advisory roles use Astra/high temporarily under PP141; the failed initial author is not a successful reading handoff.
Manager personal review and SOURCE UNBLOCK handoff completed; canonical local handoff is docs/plans/887-manager-execution-handoff.md in the manager checkout, SHA256 229b0df73a3445fe50c574aa5903c1c8c54f5adff53c91e46b0f1dd0101046df. Do not copy that coordination file into the feature PR.
PP143 §79, verbatim «اعتمد المنسّقين للتصحيح فقط (الموصى به)», authorizes the existing coordinator codex/gpt-6.1-sol/high for bounded correction only. The manager's pp143-bounded-coordinator-correction-handoff.md governs; no new author/delegate, model expansion or retrospective PASS.
The actual #832 release at 2026-11-08T06:58:04.065Z enabled #887's single scoped turn after fresh load/provenance/newer-grant checks. Reused frozen install and12 dependency builds; own lane issue887-c1 used loopback PG55487/Redis56387. Release resources after the scoped checks; test order remains independent of merge order.
Use the authorized worktree's own template, fresh locally generated credentials and exclusive-create/provenance checks under #902; authenticated private Redis must have verified free loopback port, image identity and lane/worktree ownership.
Explicitly deliver the private REDIS_URL to the test process; no shared 6379/5432 fallback, copied secrets, staging access or secret output. Teardown stops clients and removes only proven owned resources and disposable data.
On the available private execution turn, record the unchanged baseline's raw failure and silent-rounding probes before claiming reproduction; compare patched behavior on equivalent fixtures. Do not execute delivered source/tests before the coordinator personally reads their complete diff.
Worker vitest.config.ts has PostgreSQL globalSetup, so the selected existing runner must also have its own verified private PostgreSQL lane when that setup runs; do not add a test configuration or bypass setup silently.
The coordinator personally reads the complete diff before execution; frozen-lockfile dependency installation and required dependency builds are preauthorized only when the phase/resource gates allow them, followed by focused tests and worker typecheck.
Run applicable scoped lint, documentation, boundaries and module-map checks locally; full/heavy/E2E coverage remains CI-only. Missing or failed checks remain blockers, not successes.
Preserve PP-131.2's three code correction rounds and one documentation round, PP-119 consolidated pushes, four completed panel reviews on each required head, and Codex once on the final head.
Retain tested-base freshness, exact-head CI/review receipts, resolved findings, applicable verified backup and restore, and coordinated merge order; a resource turn is not an automatic merge dependency.
Immediately return phase completion/blockers to the owning manager with task/PR, exact head, actual results, remaining work and a precise recommended next action; preserve failed delivery evidence without duplicating execution.
DEP-1 deployment is separate; no runtime registration, activation, environment switch, sender change, schema migration or historical-state repair. Blockers #803/#804/#805/#808/#809/#810/#811 remain binding.

## Decision frontier
Settled: numeric schema1/full safe-integer ranges, validation/write semantics, sixteen paths, 1000 ALL/component caps, PP143 coordinator correction, fresh independent Astra/high code review, manager handoff, resource coordination and no activation.
Independent advice must assess the exact encoder, admissibility preflight cost, iterative traversal/depth compatibility, declaration order, unknown-field preservation and whether the proposed proof fits the reservation.
Local typecheck, scoped ESLint/boundaries, eight correctness suites and ten private observations passed on Redis7.4.11; lint:docs had0 errors/29 existing warnings and module-map passed. Private resource/image/byte/fence receipts remain separate. Maximum-capacity timing and CI native baseline extraction are still unproven.
No unavoidable path or scope amendment is identified now; any need to alter fixtures, context, ports/domain, runner/configuration, topology or budget requires a specific manager amendment before that work.
Legacy recovery and mixed-writer deployment behavior remain outside this repair; do not silently infer a policy from successful serialization of newly written values.
Both terminal MiniMax attempts remain rejected: initial 633 ALL and R1 1285 ALL (production144/correctness824/performance220/docs97). Original bytes, 12-shell-call audit, four truncated parts and all receipts remain operator recovery material; no source/runtime/test PASS or counter reset.
The accepted operator recovery map 928a861ea54b73558dc45d16f8718f557af94af0bcfd46d9012c726c663899fa maps all824 correctness lines through C01–C10. The coordinator reads directly with bounded visible ranges, corrects PROBE/fixtures/cap/consolidation, and measures the complete aggregate before any execution; packet transport is unnecessary for this author.
CI-only performance spec may extract six fixed-SHA baseline fragments into owned temp, fetch only ec26930497f25213b62e2b60bc603af6b9ba3527 from configured origin in CI if absent, and use Node24 native loading; no embedded baseline, second worktree, config/workflow/package/fixture edits. Missing extraction/proof is a named blocker.
Next: prepare the existing #887 draft PR for fresh CI correctness/performance verification; parent static checks and independent CODE review are complete and the private lane is released. Keep MergePilot release HOLD200 until all five candidate PRs are ready. No panel/Codex trigger, merge, release or activation is authorized by draft publication; exact-head reviews/CI, freshness, applicable backup/restore and coordinated order remain mandatory. Local performance skip is never PASS.
