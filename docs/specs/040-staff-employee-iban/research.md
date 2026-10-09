# Research — 040 employee IBAN

## R1 — IBAN structure for the six GCC countries

- **Decision**: ISO 13616 registry lengths / BBAN: KW 30 `4!a22!c`; SA 24 `2!n18!c`; AE 23 `3!n16!n`; BH 22
  `4!a14!c`; QA 29 `4!a21!c`; OM 23 `3!n16!c`. Check: ISO 7064 MOD 97-10 computed character by character
  (`remainder = (remainder * 10 + digit) % 97`), never a JS `number` of the whole value.
- **Rationale**: owner IB-Q1 = C. Registry example `KW81CBKU0000000000001234560101` verified (remainder 1).
- **Alternatives**: every registry country (rejected by the owner); BigInt arithmetic (unnecessary).

## R2 — Bank code inside the IBAN and the reference list

- **Decision**: bank code = BBAN prefix (4 letters KW/BH/QA, 2 digits SA, 3 digits AE/OM). The reference list holds
  each bank once with `ibanBankCode` filled only where it equals the bank's SWIFT BIC prefix (KW/BH/QA); SA/AE/OM
  numeric codes stay empty until confirmed. One "Other bank" entry per country.
- **Rationale**: owner IB-Q2 = C (pre-select, user confirms). A wrong code would block legitimate entries, so only
  verifiable codes are filled. Names and codes are to be confirmed by the owner/partner (reported).
- **Alternatives**: admin-managed bank table (owner: no screen now); free-text bank name (owner chose a list).

## R3 — Where the shared IBAN logic lives

- **Decision**: `packages/domain` (`iban.ts`, `gcc-banks.ts`).
- **Rationale**: pure, zero-dependency value logic needed by the API and the admin; `staff/domain` may import only
  `packages/domain`; the admin must not re-implement rules.
- **Alternatives**: a `packages/contracts` constant (domain cannot import contracts); an API endpoint serving the list
  (no instant client-side pre-selection, extra route).

## R4 — Duplicate IBAN race

- **Decision**: check-then-insert under the company-row lock that `lockEmployeeSalaryAccess` already takes
  (`FOR NO KEY UPDATE` on `companies`, then memberships `FOR UPDATE`), with the index `(company_id, iban)`.
- **Rationale**: two `FOR NO KEY UPDATE` locks on one row conflict, so IBAN writes in a company serialise; a partial
  unique index cannot express "latest revision of a non-deleted employee".
- **Alternatives**: a separate current-pointer table with a unique index (extra UPDATE-able table; a deleted
  employee's IBAN would keep blocking); an advisory lock on the IBAN (redundant with the company lock).

## R5 — Idempotency and concurrency

- **Decision**: no `Idempotency-Key`; `expected_revision` (0 = never set); same values are a no-op.
- **Rationale**: CLAUDE.md §6 requires the key only for money/stock effects; the idempotency store would keep the
  response (with the IBAN) for 24 h.

## R6 — Redaction

- **Decision**: add `iban`, `holdername` to `SECRET_SUFFIXES`; replace IBAN-shaped free text (six country prefixes)
  in `sanitize`; audit snapshots carry `iban_last4` (its key does not end in `iban`).
- **Rationale**: logs must not hold this PII; the audit log (forever, ungated) must not hold the full value.

## R7 — Holder name

- **Decision**: English only, `^[A-Za-z][A-Za-z .'-]*$`, 1–100 after trim and whitespace collapse.
- **Rationale**: owner IB-Q2 + partner note: the bank file carries the English name; an Arabic holder name has no
  consumer.
