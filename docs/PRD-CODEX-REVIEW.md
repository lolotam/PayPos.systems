# PRD v1.0 — Codex adversarial review

> **Reviewer:** Codex CLI 0.154.0, model `gpt-6-astra`, reasoning effort `high`, read-only sandbox, sources pasted inline · **Date:** 2026-09-22
> **Reviewed:** `docs/PRD.md` v1.0 (commit e8f4df5). **Outcome:** accepted findings applied in PRD v1.1 — see PRD §16.
> Reproduced verbatim below.

---

## 1. FAITHFULNESS

- **False attribution:** D-01 cites `10_Developer_Proposal_AR.md` §15 as POS-first. It explicitly orders **attendance, commissions and basic payroll before POS**. Only `client-phased-proposal-ar.md` supplies the competing POS-first roadmap.
- **Unacknowledged delivery changes:** `05_App_Blueprint_Build_Plan_AR.md` §3 promises an admin login and employee/permission management in Phase 0. PRD P1-T10 moves these to Phase 1. That correctly follows `docs/specs/phase-0/SPEC.md` §§2–3, but §13 must acknowledge the changed client deliverable.
- **Payroll postponement:** `10_Developer_Proposal_AR.md` §§4.1,15 puts basic payroll beside attendance/commissions; P5-T9 postpones it substantially. Record this explicitly.
- **Customer scope narrowed:** `10_Developer_Proposal_AR.md` §9 requires history across branches **and businesses**; P2-T3.3 restricts it to one business. Choose deliberately.
- **Features without executable tasks:** `04_Features_Spec_AR.md` §§1,3,5 and `10_Developer_Proposal_AR.md` §§4.2,7 require configurable customer/employee fields, bundles/prepaid sessions, overtime and shift swaps. PRD §7 mentions some, but §10 supplies no complete delivery slices.
- **Priority laundering:** `04_Features_Spec_AR.md` defines [M] as Phases 0–2. PRD §7 redefines it around eventual shipment, concealing delayed exports, expenses and unified reporting.
- **Unsupported assertions:** §1.2 says attendance cannot be faked by a photo; `06_Tech_Stack_Architecture_EN.md` §5.1 only limits screenshot validity. §2.2 asserts BYO eliminates licensing requirements without supplied legal substantiation. §13.8 attributes a four-week estimate to `06` §7, which contains no durations. §13.2 says `06` §2 omits `auth`; it includes it.

## 2. GOVERNING-DOC CONFLICTS

- **Read path:** P0-T10.2 specifies `get-settings` as a use case; `CLAUDE.md` §6 requires `queries/`.
- **Undeclared graph changes:** P2-T5.4 adds a payments credit-reading port absent from `docs/module-map.md` §3. P3-T3.2 adds inventory consumption of `ServiceCompleted`; P4-T2.3 makes appointments produce that event, although §4 assigns production exclusively to orders. Require explicit map amendments and ADRs.
- **Writes disguised as reads:** P4-T6.2 must not book expenses through `ChannelFeePort`. `docs/module-map.md` §§1–2 and `CLAUDE.architecture.md` §6.3 require events for cross-module effects. Likewise, P1-T6.3 cannot directly update staff-owned plan assignments.
- **Realtime exception unresolved:** `docs/module-map.md` §4 requires realtime publication for every event; Phase 0 SPEC §2 explicitly defers realtime. Polling in P1 is acceptable, but document the temporary exception.
- **Flags versus platform:** `09_Dashboards_Roles_Permissions_AR.md` §12 requires both in P0; Phase 0 SPEC §§3,7 prohibits `platform` and defers its UI. Preserve that scope, but implement tenant feature enforcement now; P5-T4.4 currently delays even the guard.
- **Security weakening:** PRD §3.2 omits TOTP for branch managers despite `06_Tech_Stack_Architecture_EN.md` §5.8. PRD §8.1 also omits ALLOW-override and multiple-membership union semantics from `09_Dashboards_Roles_Permissions_AR.md` §§10–11.
- **Slice workflow:** §10 groups schemas, entire modules and later UI passes. Under `CLAUDE.md` §1, these must be labelled epics decomposed into independently completed vertical slices, not executable module-sized tasks.

## 3. SEQUENCING

- **P0-T8 precedes its prerequisites:** real-session isolation and first-owner membership require identity schema/auth from P0-T9. Split identity bootstrap before T8. Define first-owner creation without an undeclared tenancy→identity write or an ownerless intermediate company. This defect is inherited from `IMPLEMENTATION-PLAN.md`.
- **P1-T7 is necessary and supported** by `05_App_Blueprint_Build_Plan_AR.md` §3’s simplified session entry. Move its catalog/order contracts before commission integration. Otherwise P1-T6 cannot validate real producers, late performer assignment or cancellation reversals. List `catalog` in the Phase 1 module inventory.
- **P1 frontends are correctly placed.** SPEC excludes P0 UI; the pilot requires both apps. Bootstrap shells before the first user-facing slice, rather than postponing all UI until P1-T9/T10.
- **Files and notifications are late:** P1-T2 needs private R2 uploads and expiry alerts; P1-T4 needs absence alerts. P2-T2.4 and OTP-only P1-T8 cannot supply them. Deliver minimal secure files and operational messaging in P1; keep campaigns in P4.
- **P2 prerequisites:** constraints/approvals P2-T7 must precede approval-dependent order/payment/cash slices. P2-T11’s dashboard needs read models now, not P5-T1. Printing hardware must be validated before committing to P2 scope.
- **P3:** recipes/mappings in P3-T4 must precede recipe-based consumption in P3-T3.
- **P4:** P4-T6 requires an expense-posting slice before P5-T3; P4-T4 gift-card purchasing depends on P4-T5.
- **P5:** expense and payroll facts must precede complete profitability reporting. Payroll can remain late if explicitly accepted; it is not required to prove commission accuracy.

## 4. COMPLETENESS PER PHASE

These gaps prevent the stated exits, against `05_App_Blueprint_Build_Plan_AR.md` §3 and `client-phased-proposal-ar.md` §11:

- **P0:** add feature-guard/template seed tests; classify `two_factor`, API-key and global role tables in P0-T0; specify privileged membership administration.
- **P1:** add versioned commission-rule snapshots, late-assignment/reassignment corrections, unassigned-service exceptions and a period-close completeness check. P1-T7’s barcode column alone does not deliver issuance/scanning.
- **P2:** add gateway reconciliation, partial-payment/refund recovery, production deployment/training/cutover rollback, and sustained offline acceptance beyond a toggle.
- **P3:** add opening-stock valuation/import, sale-time cost snapshots, concurrent movement tests and an actual count rehearsal.
- **P4:** add concurrent booking exclusion, customer-principal ownership tests, partner onboarding/certification and reminder retry acceptance.
- **P5:** add a spec pack, usage metering, subscription lifecycle/webhook recovery, load acceptance and a monitored month-long pilot.
- **P6:** P6-T1–T13 need named operating scenarios and acceptance owners before execution; “template” is not a completed workflow.

## 5. ACCEPTANCE CRITERIA

Most command/test exit checks are objective, but several are incomplete. Replace the following wording; scenario references must point to fixed cases, not unwritten future specs.

- **P0-T0, “classification agreed”:** “Waleed approves ADR-0003 with every enabled auth/plugin table classified before migrations.”
- **P0-T4, “rolls forward cleanly”:** “Apply migrations N and N+1 to empty and populated fixtures; verify expected schema and unchanged fixture data.”
- **P0-T8, “listed edge cases”:** “Named scenario IDs pass, including real-session tenant switching and rejection before `withTenant(B)`.”
- **P0-T13, old image “serves”:** “Previous image passes authenticated read/write smoke scenarios against the new schema; timed restores meet stated RPO/RTO.”
- **P1 exit:** “All trial-month lines match an independently approved expected dataset to 0.001 KWD; zero unresolved attendance/assignment exceptions; approval actor/time recorded.”
- **P2 exit:** “On the named device/printer profile, complete the agreed trading-day workload, including a specified outage and retries; zero lost/duplicate sales, exact ledger totals, independently reconciled cash variance, and legible bilingual receipt/kitchen-ticket fixtures.”
- **P3 exit:** “Every variance has a reason and recorded approval; historical COGS matches approved movement fixtures to 0.001 KWD; induced low-stock events produce verified WhatsApp delivery.”
- **P4 exit:** “During a defined pilot week, every accepted booking exists once, reminders meet the agreed delivery window, and a named partner order completes intake→KDS→status acknowledgement.”
- **P5 exit:** “An external merchant completes the onboarding checklist without developer action, pays a reconciled invoice, operates for 30 days, and receives every scheduled report.”
- **P6 exit:** “Each template passes its published lifecycle, exception, reversal and permission scenarios.”

These operational rewrites implement the evidence standard in `client-phased-proposal-ar.md` §§5,11.

## 6. OPEN DECISIONS

- **D-01:** correct the false `10_Developer_Proposal_AR.md` §15 citation; record phase-order approval rather than reopening the settled engineering recommendation indefinitely.
- **D-02/D-05:** merge duplicates. If D-16 selects WhatsApp, any required WABA naming approval precedes **P1-T8**, not P4.
- **D-03:** BYO merchant payments and collecting PosPay’s own subscription fees are different flows; it should not blanket-block P5-T5.
- **D-04:** decide before external onboarding. P5-T5’s “no per-branch upcharge” conflicts with the unresolved per-shop price.
- **D-06/D-07:** commercial plan names and role codes should not block all tenancy/auth work. Change the explicit SPEC blockers formally; use approved provisional seeds.
- **D-19/D-22/D-26:** block hardware selection, partner feasibility and opening-ledger design respectively—not merely their final implementation tasks.
- **Missing decisions:** commission accrual trigger and reassignment; maximum offline age and credit exposure; customer identity across businesses; ALLOW/DENY precedence; attendance overnight/missed-punch rules; accounting treatment of payroll versus already-expensed commissions. Assign these to P1-T6/T7, P2-T9, P2-T3/P4-T4, P0-T9, P1-T4 and P5-T9.

These follow unresolved semantics in `09_Dashboards_Roles_Permissions_AR.md` §§10–11 and the transcript §§1–2.

## 7. EFFORT

**Nine to eleven months is a coding budget, not a credible completion forecast.** Section 9 totals 36–48 weeks arithmetically, but serial pilot gates consume calendar time: P1 alone includes a dry-run week plus a full month.

P2 is the likeliest overrun: budget **14–20 weeks instead of 7–9**, roughly **7–11 additional weeks**, for actual hardware, offline recovery, payments and field fixes.

P5’s platform, billing, reporting, payroll and public API also exceed 6–8 weeks. My planning estimate is **12–16 focused months**, with partner waits separately budgeted. This is judgment, not measured velocity; `client-phased-proposal-ar.md` §10 itself warns that AI tools do not multiply human verification capacity.

## 8. OVER- AND UNDER-ENGINEERING

**Cut/defer:** narrow P2 to one device/printer profile; defer P4’s broad partner/menu-sync coverage; move P5 campaigns, elaborate SaaS analytics, multiple accounting formats and full payroll beyond first external sale. These are scope reductions requiring explicit reconciliation with `10_Developer_Proposal_AR.md`.

**Dangerously thin:**

- P1/P4 can emit multiple events representing the same service; dedupe by `event_id` cannot prevent duplicate commissions across distinct events.
- P2-T5’s webhook-only capture rule, inherited from `CLAUDE.md` §8, cannot describe cash or manually recorded terminal payments. Define method-specific authoritative transitions.
- P2-T9 needs durable financial dedupe beyond 24 hours, offline credit limits, revocation quarantine and preservation of unsynced sales before wiping a device.
- P3-T5 consumes `OrderCreated`, but P2-T4 allows subsequent item additions. Define kitchen submission/amendment events.
- P5-T9 must prevent double-counting commissions and attendance deductions in payroll/P&L.
- Company RLS does not prove branch/own authorization; extend negative API/export/SSE tests accordingly.

## 9. TOP 5 CHANGES

1. **Repair the dependency graph and task order:** prevents impossible slices and boundary violations.
2. **Specify financial lifecycle invariants across P1–P5:** prevents duplicate commissions, refunds, stock effects and payroll expenses.
3. **Deliver minimal flags, files, messaging and authorization prerequisites early:** prevents security bypasses and unusable pilots.
4. **Replace vague exits with executable evidence gates:** prevents declaring demos production-ready.
5. **Rebaseline scope and calendar against actual pilot waits:** prevents an unfinishable solo-developer commitment.

NEEDS REVISION — The architecture is defensible, but unresolved dependencies, financial semantics and acceptance gaps make this roadmap unsafe to execute as written.
