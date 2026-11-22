# Services import from workbook to persisted services

**Delivery** 32b-2 and 32b-3, one implementation PR. **Baseline** 68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51, including 09574e9e7 (32b-1 + 34-pre-3). This specification selects the scenarios below from [072](../spec.md), its [owner answers](../owner-questions.ar.md) and the [merged predecessor](../delivery-32b-1-34-pre-3-spec.md). The [implementation plan](plan.md) records verification and decisions still needed.

## User scenarios and acceptance

1. **32b-2 · Download a template.** A manager with business-scoped service management and the catalog feature downloads one XLSX. Its first sheet has the authoritative English headers below, with Arabic comments on their cells. Data starts at Excel row 2. The reference sheet explains all four commission rules and accepted boolean spellings, and lists the business’s open categories with English and Arabic names. Import matches their English names. Download the template for two businesses with different categories, inspect the actual workbook, then fill and preview each one.
2. **32b-2 · Preview a private file.** A manager submits a verified upload and sees the original sheet row and column of every error, including multiple errors on a row. Only rows with zero errors appear in the resolved rows list. A manager can inspect normalized prices, durations, matched categories, commission values, default markers and threshold flags before confirmation. Preview writes zero services and zero service audits. A different uploader, business, tenant or import entity cannot retrieve the data.
3. **32b-3 · Complete an already accepted import.** Given a seeded accepted request, a worker persists the entire preview once. If another import creates a matching service, or a selected category closes before assignment, the manager sees a failed status and zero services or audits from the losing request. Redelivery after success preserves the original result. The production confirmation button and acceptance endpoint belong to later deliveries.

## Functional requirements

| Authoritative header in template order | Meaning under 072 FR-001 and FR-004–007 |
| --- | --- |
| name_en | Required English service name. Its normalized key alone decides service duplicates within the business. |
| name_ar | Optional Arabic name. |
| price | Required KWD amount. Use merged price rules, normalize to three decimal places, reject excess precision. |
| duration_minutes | Optional whole minutes, 1–600. |
| category | Optional existing open category in this business. Preserve existing category assignment semantics and store its resolved ID. |
| commission_rule | FOLLOW_PLAN, ZERO, PCT or FIXED. Blank resolves to FOLLOW_PLAN with the default marker. |
| commission_value | Blank for FOLLOW_PLAN and ZERO. PCT imports percent as integer basis points, including Excel percentage formatting. FIXED imports KWD as a three-decimal string. |
| counts_toward_threshold | Blank defaults true. Accept boolean cells and the existing text spellings true/false, yes/no, نعم/لا. |

Only duration_minutes and category headers may be absent independently. Map reordered headers by name. Reject missing required, duplicate or unknown headers and empty data sheets. Report data under an unlabelled column and Excel error cells by original row and column. Trailing blanks and skipped sparse rows must preserve the numbering of subsequent data. Apply 2 MiB and 500 data-row limits and the existing archive/XML limits before saving a preview.

Within one company and business, compare English service names against open **and closed** services. All matching file rows receive the applicable duplicate errors, including an otherwise invalid row with a valid name. Names from another business do not conflict. Reuse the merged key semantics for categories and services. A closed, unknown or foreign category gives IMPORT_CATEGORY_NOT_FOUND. Blank category and duration persist as null. SI-Q1–Q9, SI-Q13 and SI-T1 settle these rules. Branch list visibility and pending category-closing work introduce no new assignment rule.

## Slice design and contracts

All four routes use the existing service guard, manage:services:business, and the catalog feature. Base path is `/v1/businesses/{businessId}/services/import`. Use the existing service-import schemas in packages/contracts/src/catalog/service-import.ts.

| Method and suffix | Observable result |
| --- | --- |
| GET /template | 200 with file_name, content_type and content_base64. Static route wins over service-ID routing. |
| POST /previews | Strict file_id input, no Idempotency-Key required. 201 with preview_id, row_count, error_count, all errors, first 100 clean normalized rows and next_cursor. |
| GET /previews/{previewId}/rows | Creator-only items and next_cursor. Cursor is the original Excel row as a decimal string. Default limit 20, range 1–100. |
| GET /previews/{previewId} | Creator-only preview_id, status, created_count and error_code. Status carries no row data. |

Use the verified private upload flow and existing import_previews entity services, with company, business and creator predicates on API reads. Unknown or out-of-scope file or preview gets the same respective 404. Preserve immutable normalized rows/errors, 24-hour expiry, RLS, existing grants, and all existing category checks. No new table or index is designed. The worker consumes ServiceImportCommitRequested with preview_id only and company in the envelope. Its seeded transition is commit_requested to committed or failed. Audit each service as manual creation with the preview creator as actor. No per-service outbox event.

## Success criteria and boundaries

The three scenarios pass through a real workbook, tenant-scoped persistence and worker redelivery respectively. The full synchronous 500-row preview meets the canonical warm median under 200 ms. Two conflicting accepted previews yield exactly one set of service/audit rows. Manual creates retain SV-02 semantics. The contract for POST /commits, acceptance idempotency, the recovery sweep, UI, customer country work and deployment belong to their existing owners. Size and error-code decision candidates are recorded in the plan.
