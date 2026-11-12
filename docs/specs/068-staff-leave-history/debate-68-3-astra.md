# Debate 68-3 — one round (PP-168), Astra unavailable, advisor stand-in

Astra (`codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox read-only`) refused the run on 2026-11-12:
`You've hit your usage limit ... try again at Nov 14th, 2026 11:20 AM` (output kept in `briefs/68-3/astra-err.txt`, outside
the repo). Per the manager's brief the round was held by the `pospay-advisor` agent (read-only, non-binding) on
`plan-68-3.md` and the implementer brief, once, with the same checklist as the Astra prompt. This is a stand-in, not an
Astra review. Findings below are condensed from its reply; the verdicts are the orchestrator's.

| # | Sev | Finding (condensed) | Verdict |
|---|---|---|---|
| 1 | P1 | Gating part (a) on the history read removes today's access: the history route answers 404 for an employee with no unended attachment (spec #901), while the open list keeps today's behaviour; a history 404 must not evict the whole scope | **Accept.** The open read is enabled once the history has settled (success or error) and sends `as_of` only when the history has data; a history 403/404 evicts only the history queries and part (b) shows its alert; an open-read 403/404 evicts the whole scope. Told to the manager as preserved behaviour, not a new rule |
| 2 | P1 | An out-of-scope `branch_id` answers 404, which would kill the tab | **Accept (via 1).** A 404 of the history is a part (b) alert only; the filter form stays usable |
| 3 | P1 | A new filter or cursor key blanks the whole section (unmounts part (a), the request form draft, the filter form, the decision editor) | **Accept.** `placeholderData: keepPreviousData` on the history; loading, alert and pagination live inside part (b); the filter form and pagination always render; actions are disabled while showing placeholder data |
| 4 | P1 | The eviction helper took arrays as effect dependencies (render loop) | **Accept.** Primitive arguments only; the key is built inside the effect |
| 5 | P1 | Unmounting «البيانات» drops unsaved form edits | **Accept.** The data panel stays mounted and is hidden with `hidden`; only the leave panel mounts lazily; test added |
| 6 | P2 | `as_of` missing from the open key; refetch after an action keeps an old boundary | **Accept.** Open key `[...prefix, 'open', cursor, asOf]` with `keepPreviousData`; no separate interval on the open read while `as_of` exists (the history poll drives it), 30 s interval only when there is no `as_of`. Clock-skew 400 across API instances is noted as a risk |
| 7 | P2 | Wording contradictions: revoked label, English «Covered…», «مستنية»/«معلقة», key section name | **Accept.** History rows show `leave.<status>` plus the revocation reason (FR-004); English «Covered outside this branch» (spec); the shared-label wording difference is owner-questions §16 (PENDING, non-blocking, recommended: keep `leave.*`); the section is `leaveHistory`, forced by the two-level `MessageKey`, recorded in the plan |
| 8 | P2 | Brief/plan drift (missing debate file, `leave-open-requests.tsx` not in the plan table, 400 path) | **Accept.** Plan and brief regenerated |
| 9 | P2 | The tab pattern `attendance-exception-tabs` is a `group` with `aria-pressed`, not a tablist | **Accept.** Same group pattern (buttons with `aria-pressed`), no `role="tab"` |
| 10 | P2 | Test gaps: the seeded key no longer matches, locale `en` only, missing cases, clock faking | **Accept.** Test brief lists them; fake `Date` only |
| 11 | P2 | Size: table and section too small for the 60-line function cap | **Accept.** `use-employee-leave-tab.ts` orchestration hook and `leave-history-columns.tsx` added; sizes in the plan raised (~780 production, ~500 tests) and reported to the manager |
| 12 | P3 | `'use no memo'`, lazy default dates, header key, key the panel by filters, two decision hooks | **Accept** (`'use no memo'`; lazy `useState` seed; `leave.decision` header; panel keyed by the applied query; two `useLeaveDecisions` instances accepted) |

Missing evidence the reviewer listed: openapi-fetch's serialization of the `types[]` key and of empty arrays (one
request-URL assertion in the tests settles it); whether the lint config enables the React purity rule (the typecheck and
lint gate settles it).

## Implementation notes after the round

The new tests found two defects, fixed through the implementer: cached rows rendered before the first fresh read (fixed: rows show only when fresh or placeholder), and the history eviction looped on a 403/404 (fixed: history denials are not evicted, plan D3). Review finding 1 is therefore met by showing the history alert while part (a) keeps working.
