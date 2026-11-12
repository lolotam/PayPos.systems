# Debate — row 43-3 (one round)

**Astra was not available.** `codex exec -m gpt-6-astra` returned "You've hit your usage limit ... try again at Nov 14th, 2026
11:20 AM" (2026-11-12). As the brief allows, the read-only `pospay-advisor` agent (Fable 5) reviewed
[plan-43-3.md](plan-43-3.md) instead. **This is a non-binding stand-in, not an Astra review.** Verdicts below are the
session's; the advisor's text is summarised, not quoted.

| # | Sev | Finding (summary) | Verdict | Where it lands |
|---|---|---|---|---|
| 1 | P1 | `package_entitlement_id: null` meaning "paid" lets a toggled-on line with no pick be sent as a paid line at the catalog price | accept | D1: separate `from_package` boolean; `package_entitlement_id` required while it is on; the command builder throws instead of falling back to paid |
| 2 | P1 | `!expired` in D3 uses today's branch date; the server checks the visit's date (FR-024), so a backdated or appended visit would hide a package the server accepts | accept | D3: when the visit time is explicit (`occurredAt` defined) expired-but-with-free-sessions packages are listed, marked, selectable; the suggestion only considers non-expired ones; the server stays the authority |
| 3 | P1 | A redeemed line looks paid in the saved view (`savedServiceLine` has no package marker; price/net and an Edit button the server refuses) | **escalate, not in this PR** | Needs a field on `savedServiceLine` and its read-backs (the 43-2 writer's response and the day reads), plus the visit-total question. Reported to the manager as a follow-up with options; the manager's 43-2 answer said "43-3 adds it if the screen needs it", so this is the manager's call, not guessed here |
| 4 | P1 | No `EXPLAIN ANALYZE` for the new joins (CLAUDE.md §9) | accept | Test row 13: index list gains the three tables, no seq scan on a large fixture, 200 ms wall clock. A missing index stops the session |
| 5 | P2 | Price round trip and hidden-field validation unspecified | accept | D1: price/discount untouched while on; `validate` reads `from_package`; test that a stale invalid price does not block a package submit |
| 6 | P2 | Recovery gaps (placeholder price, null customer after reload strands the line) | accept | D2: customer gates turning ON only; turning OFF always allowed; recovered line label falls back to the service id |
| 7 | P2 | Changing the customer before first save keeps old picks | accept | D2: the form clears `from_package` and picks on every line when the customer changes |
| 8 | P2 | Freshness: invalidate only on success; per-line hooks race `fetchNextPage`; suggestion on a partial list | accept | D5: invalidate in `onSettled`; one list owner at form level that pages to the end with a cap of 10 pages and a visible error/retry; no suggestion until the list is complete |
| 9 | P2 | In-form count rules (exclude own pick, feed reduced list into the suggestion) and over-pick after refetch | accept | D3/D4: own row excluded; suggestion uses the reduced options; a chosen option with remaining 0 is a validation error |
| 10 | P2 | History fetch too eager | accept (already planned) | fetch only after the section is opened; error stays inside the section |
| 11 | P2 | Contract fallout: detail spec fixtures, 42-4r exact-key HTTP assertions; deploy skew | accept | test rows added; policy: `redemptions` is required, admin and API deploy together |
| 12 | P2 | Query shape: correlated subselect, explicit company/business on every join, join through slot and line ids | accept | brief item 2 |
| 13 | P2 | `SessionDraftLines` size/function limit | accept | row component extracted to `session-draft-line-row.tsx` |
| 14 | P3 | `redeemed_at` is the recording instant; order by the visit | accept | order by `ss.occurred_at DESC, s.ordinal DESC, r.id` |
| 15 | P3 | Suggest by `(expires_on, id)`; date-only formatting; `<bdi>`; stale comments; `aria-pressed` | accept | D4, brief |
| 16 | P3 | Tests must name visible outcomes | accept | Agy brief |
