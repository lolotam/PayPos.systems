# Debate 057-3b-2 — Astra, one round (2026-11-12)

Reviewer: Codex `gpt-6-astra`, effort medium, read-only sandbox, on the 3b-2 slice brief (pure rules: domain + ports) against the spec, plan-057-3b.md, CLAUDE.md §§3.1/4/9/11, the sibling 057-3 files and the contracts.

## Findings (verbatim)

1. **P2 — Outgoing payload cannot satisfy its required contract type.** The brief requires `proposal_ids: readonly string[]`, then requires assignability to `DiscountSelfApprovalNoticeRequested`. That contract infers mutable `string[]` from `z.array(id)` (`packages/contracts/src/orders/discount-approval-events.ts:71`). TypeScript rejects that assignment. Following the sibling's readonly recipient-array convention introduces the same mismatch for `notification_recipients`. The parameter-only runtime parse test cannot detect either problem.

   **Fix:** Keep properties readonly but use mutable array value types in the outgoing DTO, or explicitly require adapter conversion to the mutable contract shape. Add a compile-time whole-payload compatibility assertion in the test file; keep contract imports outside production domain/ports.

No other substantiated defects found. Ports provide the capabilities needed by 3b-3. Tenant isolation, atomic claim/outbox writes, rollback and concurrency remain integration obligations already assigned by the plan. Integer bps handling, recipient roles, approver inclusion, reuse and Arabic JSDoc requirements align.

## Verdicts

| # | Verdict | Reason and change |
|---|---|---|
| 1 | accept | The brief's "assignable to the contract" claim was wrong for readonly arrays. The payload properties stay readonly with mutable array types, and the spec adds a compile-time whole-payload assignment plus a runtime `discountSelfApprovalNoticeRequested.parse`. The contract import lives in the test only. |

Note found while briefing (not an Astra finding): `plan-057-3b.md` and its debate verdict #4 call the place method `forBranch`; the real method on `DiscountApprovalNoticePlace` is `branchPlace`. 3b-2 narrows `branchPlace`.
