# Feature Specification: Customers — find or create by phone

**Feature Branch**: `feat/p1-34-customers`
**Created**: 2026-10-03
**Status**: Implementation scope settled; deferred owner questions below
**Input**: Phase 1 plan row 34; SPEC §§2–4, §11 R1; PRD D-30/D-43; ADR-0007/0010; owner decision 2026-10-03.

## User Scenarios & Testing

### User Story 1 — Reception identifies a customer (Priority: P1)

Reception selects a country (Kuwait by default in PR 35) and enters the national phone, name and preferred language to identify a customer before recording a session.

**Why this priority**: Sessions need one company-wide customer identity across businesses.
**Independent Test**: Finding a new phone creates one customer; repeating it returns that customer.

**Acceptance Scenarios**:

1. **CUS-01**: Given no matching phone in the verified company, a valid request creates a customer and an audit entry atomically.
2. **CUS-02**: Given a matching phone, the request returns the existing customer without changing name, locale, timestamps or opt-out preference.
3. **CUS-03**: Concurrent requests for the same phone return the same id and create exactly one row and audit entry.
4. **CUS-04**: The same phone in two companies creates two separate customers; an unauthorized company selection is refused before customer access.
5. **CUS-05**: Invalid selected-country/national input is refused with a named bilingual error and no saved customer.
6. **CUS-06**: All responses expose only the phone's last three digits; successful, rejected and failed requests leave no full phone in logs or errors.
7. **CUS-07**: Creation rolls back if its audit write fails; no outbox event is published.
8. **CUS-08**: Missing permission, missing session and a disabled customer feature prevent access.

### Edge Cases

- The API accepts a strict phone object with ASCII digit-only calling_code (1–3 digits) and national_number. Legacy full-phone strings, plus signs, extensions, non-ASCII digits and control characters are invalid.
- Domain normalization strips standard separators (spaces, parentheses, hyphens and dots) and all leading national zeros, then composes E.164. The API requires digit-only fields; domain separator handling is independently tested.
- A calling code cannot start with zero; the normalized national number cannot be empty; the combined E.164 number has at most 15 digits. Kuwait (965) requires exactly eight national digits after normalization.
- This slice does not verify allocation or ownership of a number.
- A competing creation that commits is read by the next statement inside the same tenant transaction. A competing rollback permits the waiting insert to create the row.
- Existing opted-out customers remain opted out; lookup is not consent to receive messages.
- Customer names reject Unicode control characters (C0, DEL and C1), including NUL, before whitespace trimming; the existing trimmed 1–200 character bounds remain. Invalid names return `VALIDATION_FAILED` without input details.
- Every database failure crossing the customer persistence boundary becomes a fresh `CustomerPersistenceError` (`CUSTOMER_PERSISTENCE_FAILED`), without the driver's cause, message, parameters or stack. This applies to customer writes/lookup, audit writes and transaction completion; the HTTP envelope remains `INTERNAL_ERROR`.

## Requirements

### Functional Requirements

- **FR-001**: Identity and phone uniqueness are company-wide; packages and ratings remain business-scoped (D-30).
- **FR-002**: Accept `{ phone: { calling_code, national_number }, name, locale }`, with explicit `ar` or `en`; the selected country is explicit (owner decision 2026-10-03).
- **FR-003**: Return id, name, locale, opted-out flag and masked phone only.
- **FR-004**: Preserve an existing record as explicitly required by this lane; updating it is outside this use case.
- **FR-005**: Creation and its privacy-safe audit are one transaction, and concurrent creation is deduplicated.
- **FR-006**: Require the new catalog permission without adding any seeded role assignment.

### Key Entities

- **Customer**: Company-owned identity, name, international phone, locale and opt-out time.
- **Audit entry**: Actor and created customer identity, with an allowlisted masked snapshot.

## Slice design

### Business rules

- **BR-001**: Normalize explicit calling code and national number to canonical E.164; strip separators and national leading zeros; enforce 2–15 total ASCII digits and exactly eight national digits for Kuwait (owner decision 2026-10-03).
- **BR-002**: Find existing without changing name/locale; first committed creation wins concurrent requests.
- **BR-003**: Mask as `***` plus the final three digits (R1/D-43), or both digits at the syntax-only two-digit minimum.
- **BR-004 — future deletion/restoration**: An archived customer's phone restores the same customer id, history, packages and opt-out state; it never creates a replacement. Keep unconditional company/phone uniqueness. Deletion, archive storage and restoration writes belong to the future delete slice (owner decision 2026-10-03); PR 34 has no archived records or deletion action.
- **TODO(spec) — PR 35 country selector**: Decide the offered country list in the reception screen; Kuwait is selected by default (owner decision 2026-10-03). Recommendation: offer Kuwait and the countries reception actually serves, submitting the selected calling code explicitly.
- **TODO(spec) — seeded roles (PR 7a)**: No role assignment here. Recommendation: Owner and explicitly authorized reception/manager memberships; decide whether a company-scoped permission is appropriate for branch-only reception before granting it.

### Schema changes

| Table | Columns | RLS | Indexes | FKs |
|---|---|---|---|---|
| customers | company_id, id, name, phone, locale, opted_out_at nullable, created_at, updated_at | ENABLE + FORCE; SELECT/INSERT only for pospay_app with tenant predicate | PK (company_id,id); UNIQUE (company_id,phone) covers lookup, RLS and company FK | company_id → companies(id) |

CHECKs enforce E.164 syntax, ar/en locale and nonempty bounded name. No business_id (D-30). UUID v7 and timestamps supplied through injected ports. Existing migrations are untouched; table/index migration and custom RLS/grants migration are separate.

### API contract

- **Endpoint**: `POST /v1/customers/find-or-create`, HTTP 200 on create and find.
- **Access**: exactly one `@Require('create:customers:company')`; `@RequiresFeature('customers')`.
- **Context**: selected company resolved by the existing access guard; body is strict and cannot select a tenant.
- **Schemas**: `FindOrCreateCustomerInput`, `Customer` in `packages/contracts/src/customers.ts`; generated OpenAPI and admin/POS clients.
- **Response**: `{ id, name, locale, opted_out, phone }`, where phone matches `***` + up to three final digits.
- **Idempotency-Key**: not required; no money/stock effect, dedupe by persistent company/phone constraint.
- **Errors**: `INVALID_CUSTOMER_PHONE`, `VALIDATION_FAILED`, auth/permission/feature errors, `NOT_READY`, `INTERNAL_ERROR`; bilingual catalog messages, no input values in details.

### Permissions

`create:customers:company` catalog entry. Exclude it from automatic Owner seeding pending PR 7a; existing assignments are untouched.

### Events

None published or consumed: SPEC §3 names no event for this step. Orders' `CustomerLookupPort` belongs to PR 35. Public module surface exports wiring only.

### Test plan

- **Domain unit**: selected calling code, separators/leading zeros, Kuwait length and E.164 boundaries; invalid error has no input; masking; privacy projection with opt-out.
- **Use-case unit**: normalization before transaction; deterministic injected time/ids; audit only for insert; preserve existing; repository/audit rollback covered by integration.
- **Integration**: CUS-01…08 using real API/auth and Postgres, synthetic reserved phone fixtures, captured logs; concurrency and rollback.
- **Privacy regression**: NUL-name HTTP requests return 400 without phone data; bypassing the contract reproduces PostgreSQL SQLSTATE 22021 and proves the adapter exposes only a fresh named error, including when caught inside the transaction callback.
- **RLS negative**: restricted app role, cross-tenant SELECT=0, INSERT refused, no UPDATE/DELETE privilege, foreign roles denied, identical ids across companies allowed, no context reads.
- **Contracts**: strict nested digit-only phone input, calling-code bounds, locale/name limits, masked-only response, generated path/status parity; country-length and composed E.164 rules stay in domain.
- **Queries**: no standalone read endpoint or `queries/` implementation in this write slice; command repository lookup uses company/phone unique index.
- **Gates**: `pnpm check` with FORCE_COLOR unset; API/admin/POS builds; bounded production bootstrap test with optional configuration empty because app wiring changes.

## Success Criteria

- **SC-001**: Repeated and concurrent reception requests identify exactly one customer per company and phone.
- **SC-002**: All customer responses and diagnostic output reveal at most the final three phone digits.
- **SC-003**: No request identifies or changes another company's customer.
- **SC-004**: Every new customer has exactly one committed creation audit entry.

## Assumptions

- G1 is done; existing authentication, authorization, feature guard and transaction wrappers are reused.
- No UI: reception form arrives with PR 35; no orders, imports, ratings, consent changes or messaging in PR 34.
- The owner decision 2026-10-03 settles normalization and future restoration; the country selector list and seeded-role decisions belong to PR 35 and PR 7a respectively.
- Name is one entered customer name, as SPEC §4 requires, rather than bilingual business catalog names. Technical input bounds: 200 name characters and 64 national input digits before normalization.
