# Plan: 32b-cat-3, the admin category screen

Roadmap row `32b-cat-3` («شاشة التصنيفات»), the last category row of [spec 072](spec.md) before the import. It is
the screen over the API that `32b-cat-1`, `32b-cat-1b`, `32b-cat-2` (#996) and `32b-cat-2-worker` (#1021, #1050)
merged. **Admin only.** No API change, no migration, no new permission.

## Prerequisites (checked on `origin/main` 8ca472831)

- **The routes exist and are in the generated admin client** (`apps/admin/src/shared/api/schema.d.ts`):
  - list, create, detail, rename, `close` and `reopen` under `/v1/businesses/{businessId}/service-categories`;
  - `GET …/service-categories/{categoryId}/closings/{closingId}`;
  - the branch routes `…/branches/{branchId}/service-categories` (list by `view`, create, rename, `PUT …/state`);
  - `POST …/services/{serviceId}/close` and `…/reopen`.
- **The detail read carries the confirmation inputs:** `open_service_count`, `marked_service_count` and `pending_closing_id`.
  The list item does **not** carry `pending_closing_id`.
- **Close and reopen answer 200 or 202.** The body is the category result, or `{ closing_id, status: 'pending' }`
  with HTTP 202 (`service-categories.controller.ts`). The `kind` union in `service-category-closing.ts` is the use
  case's outcome; it is never on the wire. The client tells the two apart by the HTTP status.
- **Owner answers:** PP-191 (SI-Q29 to SI-Q31) is answered, and nothing in `owner-questions.ar.md` is `PENDING`.
  SI-Q30 sets the screen:
  - the screen keeps working and the category shows «جاري القفل…»;
  - when the job finishes it shows «اتقفل التصنيف و<N> خدمة»;
  - on failure it shows the reason in plain words and a «حاول تاني» button.

  SI-Q29 to SI-Q31 are feature questions. If Abu Salem's pick on SI-Q30 differs, it replaces this screen behaviour
  in a follow-up.
- **Deferrals:** no deferral in `docs/owner-decisions.ar.md` names a `32b-cat` row.
- **Admin today** has no category page. It has only:
  - `useOpenServiceCategories`, the open list that the service picker and filter read;
  - the picker (`service-category-field.tsx`) and the filter (`service-category-filter.tsx`).

## Scope: the spec row does not fit one PR

`spec.md` row `32b-cat-3` has four parts (estimate 400 to 600 lines, written before the 202 path existed):

1. the list (open, closed, all), create and rename;
2. category close and reopen with the count, single-service close and reopen on the service panel, and the closed
   mark on the services list;
3. the branch context (SI-Q19 to SI-Q22);
4. the component tests.

Sized against the existing services-page files, all of it is about **1,350 to 1,500 production lines** with the 202
path. That is over the PP-192 band (600 to 900). The plan splits the row, by what a manager does on one screen:

| Part | This PR, `32b-cat-3a` | Next PR, `32b-cat-3b` |
|---|---|---|
| Business category page: list (open, closed, all), paging, create, rename | in | |
| Category close and reopen: the confirmation with the count, 200 and 202, polling, «جاري القفل…», the done and failed states, «حاول تاني» | in | |
| The refusals of close, reopen, create and rename | in | |
| Copy for `SERVICE_CATEGORY_CLOSING_EXPIRED` and `SERVICE_CATEGORY_CLOSING_FAILED` (missing from i18n today) | in | |
| Closed mark on a closed service in the services list (`closed_at` is already in `ServiceListItem`) | in | |
| Single-service close and reopen on the service panel (`close:services:business`) | | in |
| Branch context: the `in_use` and `available` views, create shared or private, make shared, enable, hide | | in |

The split follows the order the spec gives. `3a` stands alone: a business manager can manage, close and reopen
categories. `3b` adds a new hook family (branch routes) and a separate permission path; it touches none of `3a`'s
files except the page shell and the i18n catalogs.

## Decisions

| # | Decision | Why |
|---|---|---|
| U-1 | **Route and nav.** New page `apps/admin/app/(dashboard)/catalog/categories/page.tsx`, a thin re-export of `src/catalog/pages/service-categories-page.tsx`. `catalog-nav-item.tsx` gains a «التصنيفات» link. Its `active` rule for services excludes `/catalog/categories`, the same way it already excludes `/catalog/package-types`. | CLAUDE.md §7: `app/` holds routes and re-exports only. |
| U-2 | **Hooks** live in `src/catalog/api/`, one file per resource, on `apiClient()` and TanStack Query, the same as `use-services.ts`. The query key root `['service-categories', companyId, businessId, userId]` is shared with `useOpenServiceCategories`, so one invalidation also refreshes the service picker and the filter. | One key root, so the cache is not left stale. |
| U-3 | **List.** `GET …/service-categories?status=open\|closed\|all&cursor&limit=20`, three tabs, default `open`, cursor paging as on `services-page.tsx`. Each row shows both names, the visibility and a closed mark. It also shows «جاري القفل…» or «جاري الفتح…» while this screen tracks a pending job for that category (U-6). | Spec row part 1. |
| U-4 | **Create and rename.** One form with both names required, posting `createServiceCategoryInput` and `renameServiceCategoryInput` with `expected_revision`. Visibility is fixed to `BUSINESS` on this page (the private and shared choice is branch context, `3b`). An error shows the envelope message through `envelopeMessage`. `SERVICE_CATEGORY_REVISION_CONFLICT` adds a «إعادة التحميل» action that re-reads the detail. | Spec: both names required; existing form pattern. |
| U-5 | **The confirmation reads the detail first.** Close and reopen open a confirmation that reads `GET …/{categoryId}` and names the count: `open_service_count` for close, `marked_service_count` for reopen. It then posts `{ expected_revision, expected_service_count }` from that same read. A count of zero is shown and allowed, as the API accepts it. | The count the manager confirms is the count the API checks. |
| U-6 | **200 against 202.** The mutation reads `response.response.status`. On **200** it shows the done state at once, with `services_closed` or `services_reopened`. On **202** it stores `{ categoryId, closingId, action }` in page state and starts the status read. The status read is `useQuery` on `…/closings/{closingId}`, with `refetchInterval` set to `CLOSING_POLL_MS` (2,000 ms, an exported constant that tests replace) while `status === 'pending'`, and `false` otherwise. The page stays usable while the job runs (SI-Q30). | The 202 body carries no category fields, so only the status code tells the two paths apart. |
| U-7 | **After a reload.** When the detail read returns a non-null `pending_closing_id`, the panel picks the job up and polls it the same way. The list row alone does not know about a job started in another tab or before a reload, because the list item has no `pending_closing_id`. The row learns about it once the category is opened. Adding the field to the list read is an API change and is **not** in this plan (see «Decision for the manager»). | No API change in a UI row. |
| U-8 | **The states, from one pure function** `closingView(status)` in `src/catalog/model/service-category-closing.ts`. `pending` → «جاري القفل…» or «جاري الفتح…». `completed` → «اتقفل التصنيف و<N> خدمة» or «اتفتح التصنيف و<N> خدمة». `failed` → the `error_code` message from `packages/i18n` plus «حاول تاني». «حاول تاني» re-reads the detail and opens the confirmation again with the fresh count; it never re-sends the old body. | SI-Q30 option 1, word for word. A retry with stale numbers would only fail with the same code. |
| U-9 | **Refusals of close and reopen (synchronous 409):** `SERVICE_CATEGORY_COUNT_CHANGED` and `SERVICE_CATEGORY_REVISION_CONFLICT` show the message, re-read the detail, and keep the confirmation open with the new count. `SERVICE_CATEGORY_CLOSING_IN_PROGRESS` shows its message and starts polling the running job from `details.closing_id`. `SERVICE_CATEGORY_ALREADY_CLOSED`, `SERVICE_CATEGORY_NOT_CLOSED` and `SERVICE_CATEGORY_NOT_FOUND` show the message and refresh the list. `FORBIDDEN` (403) shows the envelope message; the admin hides no button by permission today, and the server decides (same as the package-type screen). | Spec: «the screen reloads the count and asks again». The job already running is the answer the manager wants. |
| U-10 | **Errors of the status read:** a 404 `SERVICE_CATEGORY_CLOSING_NOT_FOUND` or a 403 stops polling and shows the envelope message. A network error keeps TanStack's default retry; polling resumes on the next interval. | Polling must end on any answer that will not change. |
| U-11 | **Invalidation on done**, from a 200 or from a job that reaches `completed` or `failed`: the category key root (list, detail, the open list of the picker and filter) and the services list key root (closed marks and categories). | A closed category must leave the service picker at once. |
| U-12 | **The closed mark on the services list:** `service-table-row.tsx` shows a «مقفولة» badge when `item.closed_at` is set. There is no new filter, and the list read is unchanged. | Spec row part 2. The data is already there. |
| U-13 | **Copy.** New keys in `packages/i18n` (en and ar) for the page, tabs, form, confirmation, states and nav, plus the two missing failure codes `SERVICE_CATEGORY_CLOSING_EXPIRED` and `SERVICE_CATEGORY_CLOSING_FAILED` in `catalog-service-categories.ts`. No hardcoded string; logical CSS properties only. | CLAUDE.md §7. |

## Files and sizes (production, hand-written; tests apart)

| Category | Files | Lines |
|---|---|---|
| Route, nav | `app/(dashboard)/catalog/categories/page.tsx`, `_frame/catalog-nav-item.tsx` | ~15 |
| Hooks | `api/use-service-category-list.ts`, `api/use-service-category-detail.ts`, `api/use-service-category-save.ts` (create, rename), `api/use-service-category-closing.ts` (close, reopen, status poll) | ~280 |
| Pure model | `model/service-category-closing.ts` (`closingView`, poll rule) | ~45 |
| Page and UI | `pages/service-categories-page.tsx`, `ui/service-categories-table.tsx`, `ui/service-category-row.tsx`, `ui/service-category-status-tabs.tsx`, `ui/service-category-form.tsx`, `ui/service-category-panel.tsx`, `ui/service-category-closing-confirm.tsx`, `ui/service-category-closing-notice.tsx`, closed mark in `ui/service-table-row.tsx` | ~460 |
| Copy (ar and en) | `packages/i18n/src/catalog-service-categories.ts` (+ screen keys) | ~110 |
| **Production total** | | **~850 to 910** |
| Tests (not counted) | hook specs (200 and 202 branch, polling with fake timers, stop on terminal and on 404), `closingView` unit spec, page and panel specs | ~500 |

No file goes over 300 lines, and no function goes over 60 lines.

## Tests (visible outcomes, PP-7.2)

- The 202 path with an injected `CLOSING_POLL_MS`:
  - the row and the panel show «جاري القفل…» while the status is `pending`;
  - after the next poll returns `completed` with 450, the screen shows «اتقفل التصنيف و450 خدمة», and the row shows
    the closed mark;
  - the same flow for reopen.
- A failed job shows the plain message for `SERVICE_CATEGORY_COUNT_CHANGED` and a «حاول تاني» button. Clicking it
  re-reads the detail and shows the confirmation with the new count.
- A synchronous 409 `SERVICE_CATEGORY_COUNT_CHANGED` shows the refusal message and the new count in the confirmation.
- `SERVICE_CATEGORY_CLOSING_IN_PROGRESS` shows its message and then «جاري القفل…» for the job in `details.closing_id`.
- A detail with a non-null `pending_closing_id` shows «جاري القفل…» after a reload.
- The confirmation names the count from the detail read, and the posted body echoes `expected_service_count` and
  `expected_revision`.
- The tabs show only closed rows on «مقفولة».
- Create and rename refuse an empty Arabic name with a visible message.
- A closed service shows «مقفولة» on the services list.
- Both locales, with the `dir` checked as `services-list.spec.tsx` does.
- A mock-call assertion never stands alone.

## Delivery (PP-186 lanes, fences as in 32b-cat-2-worker)

- **Implementation:** Kimi `k3.1-pro` CLI through the relay, behind the env-stash fence (HEAD, stash and status are
  checked before and after). PP-112 fallback: MiniMax, then Grok.
- **Tests:** Agy `gemini-3.8-flash-high`, in a separate brief on the same contracts.
- **Briefs:** each under 400 lines; a delivery over twice the brief's size is refused.
- **Claude:** reviews the diff, runs `clean-code-guard`, `test-guard` and `docs-guard`, then runs the local gates:
  - `pnpm --filter @pospay/admin typecheck`, `lint` and the admin specs;
  - `pnpm lint:docs`, `pnpm module-map:check` and prettier on the touched files.
- **No database lane** is needed (admin only). One PR. No review is requested until the manager says so.

## Decision for the manager

1. **Split:** `32b-cat-3a` (this plan, ~850 to 910 production lines) now, and `32b-cat-3b` (single-service close and
   reopen plus the branch context, about 500 to 600) as a new roadmap row after it. The alternative, the whole spec row
   in one PR, is about 1,400 lines, over PP-192.
2. **Optional API gap (not in this plan):** add `pending_closing_id` to the category list item, so a row shows
   «جاري القفل…» after a reload without opening the category. It is about 20 API lines plus tests and is a
   `32b-cat-2-worker` follow-up. The recommendation is to skip it: the detail read already covers the reload case.
