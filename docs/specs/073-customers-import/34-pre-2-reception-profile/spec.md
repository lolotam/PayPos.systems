# 34-pre-2 · Reception registration and customer card

**Design baseline** 68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51, origin/main. One delivery with three acceptance items and one implementation PR. [Implementation plan](plan.md) · [Spec 073, CIM-12 to CIM-16 and delivery order](../spec.md) · [Owner answers CI-Q8–Q14, CI-Q17 and CI-T6](../owner-questions.ar.md) · [34-pre-1 decisions S-2 to S-8](../34-pre-1-plan.md).

## User scenarios and testing

1. **Register at reception.** Staff enter the existing name, phone with explicit calling code and locale, select «أنثى» or «ذكر», and optionally supply a birthday, email and a note for the current business. Saving selects the customer for the visit or package sale. Only authorized business and branch entry offer the note. Display «ماتكتبش أسرار أو بيانات حساسة» beside it. Company entry offers the other fields.
2. **Open the selected customer's card.** Display the saved profile, including gender, birthday, email and the notes returned for all businesses in this company, each labelled with its originating business name in the active language (fall back to the English name). Absent values and an empty notes list have a localized empty state. Show a partial birthday without a year. Show a masked phone. Keep visit recording and package selection usable if profile loading fails, with a localized read error and a retry for the same selection.
3. **Find an existing customer without gender.** A receptionist with a known phone can still resolve a legacy customer and open the card without supplying or correcting gender. An unknown phone without gender cannot create a record. Show how to complete registration, preserve the entered fields, and let the user retry with a selected gender. A known customer's saved fields and notes survive repeated valid submissions unchanged.

## Requirements

| Item | Acceptance |
| --- | --- |
| 1. Entry | Both shared-field callers support the authorized entry scope. Gender has no preselection. Blank optional controls are omitted. Birthday needs day and month together, year optional. Accept 29 February with unknown year or a leap year, reject impossible dates and a year alone. Never manufacture 2000. Email uses the existing trimmed 3–254 Unicode code-point, literal @ and dot, control-character rules. No uniqueness or confirmation. Note uses trimmed 1–500 code points, preserves interior newlines and rejects NUL. |
| 2. Card | With two businesses in the same company, both notes appear with the correct names. A different tenant's customer and a missing customer are indistinguishable. A rapid change of selection, scope or user never shows an earlier profile or note, including during a late success, failure or retry. |
| 3. Activation | Company, business and branch use the same conditional rule. Known normalized phone with omitted gender succeeds, even for a stored NULL. Unknown phone with missing gender fails without customer, note or audit writes. A supplied unsupported gender fails validation. No client declaration can force existing status. Concurrent valid submissions for the same company/phone return one identity with at most one creation audit and one initial note. |

## Slice design

- **Business rules and entities.** Customer identity is company-wide. “Customer type” in this delivery means the established gender field, stored as female or male. Notes belong to a customer and a business. Reception writes profile values only on successful first creation. Import's fill-empty rule belongs to 34b.
- **Storage.** Existing nullable columns, constraints, note table, tenant isolation, indexes and foreign keys suffice. Legacy rows require no repair. No DDL, backfill, new index or schema-level required gender. No new query shape requiring EXPLAIN.
- **API and access.** Retain the three find-or-create POSTs, their masked identity projection and the three authorized profile GETs described in the plan. Authenticated tenant, customers feature and existing scoped create permissions govern both operations. Phone uniqueness and the existing transaction govern repeats. No new idempotency header, privilege, event or notification.
- **Privacy.** Never publish profile fields into visit/package selection, journals, browser persistence, analytics, error details or creation audit. Full phone stays out of responses and logs. Email, birthday and note text appear only in authorized entry/profile views. Discard transient input and profile data when identity or scope changes.
- **Tests.** Prove each row above in visible Arabic/English UI, contract/use case and relevant tenant-scoped integration coverage. Exercise old and new caller combinations before release as described in the plan.

## Success criteria and scope

All three scoped writes distinguish existing from new correctly. Both callers open saved cards from their normal entry points. An authorized user can register with just the required data, open a legacy record with zero required profile edits, and see a partial birthday without an invented year. No customer or note crosses company boundaries.

Country configuration (34-pre-3), import template/preview/worker (34b), customer self-registration, general search, profile editing and package entitlements have their own deliveries. No outstanding product choice was identified. The deployment pairing requires operational verification.

## Delivery record (implementation)

Implemented on `origin/main` `aa1c79569` in one PR. No migration, permission, import or deploy change: the contract keeps gender optional for lookup and `requireCustomerGender` in `apps/api/src/modules/customers/domain/profile.ts` rejects a miss without it before any id, timestamp, note-business lookup, insert or audit. Legacy NULL rows are found and opened unchanged. The shared reception field renders the new inputs and the selected card's profile; the company entry has no note field and the scoped entries show the privacy notice. Release pairing: a new admin bundle against an old API replica can still create NULL rows, and an old bundle against a new API cannot create new customers; coordinate API cutover, admin asset switch, stale-tab reload and rollback as specified in the plan table. No target DB or deployment was touched.
