# Plan: 32b-pre-2, duration and category on the services screen

Roadmap row 32b, sub-PR `32b-pre-2` of [spec 072](spec.md) (the delivery table row "Duration and category on the
service: the form, the list and the filter"). The API is already merged in `32b-pre-1` (#757): the contract fields
`duration_minutes` and `category_id` on create, update, detail and list, the list's `category_id` filter, and the
category label (`name_en`, `name_ar`, `closed_at`) on every service shape. This PR is `apps/admin` and
`packages/i18n` only.

## Scope

- No migration, no contract change, no API change, no change to `apps/admin/src/shared/api/schema.d.ts` (32b-pre-1
  regenerated it).
- No owner question. SI-Q6 to SI-Q10 settle the unit and limits (whole minutes, 1 to 600), both fields optional, and the
  list filter. The decisions below are screen design.
- Not touched: `apps/admin/src/commissions/**` (49-2 works there), the category screen (32b-cat-3), closing a service or a
  category (32b-cat-2, 32b-cat-3), the import (32b-1 onwards).

## Decisions

| # | Decision | Why |
|---|---|---|
| P-1 | The picker and the filter read the business category list `GET /v1/businesses/{businessId}/service-categories?status=open&limit=100`, following `next_cursor` until it is null, in one new hook. | The spec row says "offers only open categories (from the category list read)". Closing a category does not exist until 32b-cat-2, and 32b-cat-3 owns the closed-state screens, so one hook and one status serve both. |
| P-2 | Create and update send `duration_minutes` and `category_id` whenever the category list loaded: a value, or `null` for "none". | The update contract's "omitted keeps, `null` clears" rule; the form always knows both fields. |
| P-3 | When the category list is refused (403, a user with `manage:services:business` but without `read:service-categories:business`), the form shows the current category as read-only text with a note, hides the filter, and **omits** `category_id` from the request. Duration still works. | Omission is the contract's "keep" path, made for a client that cannot set the field; the service shapes already return the category label to any reader of services. |
| P-4 | Editing a service whose current category is not in the open list (it was closed): the picker shows it as the selected option with the closed mark; the user may keep it, change it to an open one, or clear it. Keeping it re-sends the same id, which the update use case accepts (`categoryChanged` is false, so no open check). | No silent change of a stored value. |
| P-5 | Duration input: a text input with `inputMode="numeric"`; `setValueAs` turns a blank into `null` and anything else into `Number(value)`; `serviceDurationMinutes` (`int`, 1 to 600) in the contract decides. `90.5`, `0`, `601` and `abc` show the field error; nothing is rounded. | One source of truth for the limits (the contract), as the price field does with `normalizeKwdInput`. |
| P-6 | Labels: a category shows `name_ar` in Arabic and `name_en` otherwise (both names are required on a category). The duration cell shows the number of minutes in a `dir="ltr"` span followed by a short minutes-unit key (`t` takes no interpolation values); no duration shows a dash. A closed category shows a closed mark beside its name. | §7 frontend rules: i18n keys only, RTL-safe. |
| P-7 | The filter is a select above the table: "all categories" plus the open categories. Changing it resets the cursor and closes the edit panel; the list query key includes the filter. | A cursor from one filter is meaningless in another. |
| P-8 | The forms stay network-free: the pages own the category query and pass it to the forms as a prop. | Component tests render the forms with fixtures. |

## Files

| File | Change |
|---|---|
| `apps/admin/src/catalog/api/use-services.ts` | `create()` and `update()` carry the two fields (P-2, P-3); `list()` forwards `category_id`; the list query key includes it |
| `apps/admin/src/catalog/api/use-service-categories.ts` | new: the open-category hook of P-1 |
| `apps/admin/src/catalog/ui/service-attributes-fields.tsx` | new: the duration input and the category picker (P-3 to P-5) |
| `apps/admin/src/catalog/ui/service-form.tsx`, `edit-service-form.tsx` | render the new fields; default values gain both fields |
| `apps/admin/src/catalog/pages/create-service-page.tsx`, `pages/services-page.tsx` | own the category query (P-8); the filter state (P-7) |
| `apps/admin/src/catalog/ui/service-category-filter.tsx` | new: the filter select (P-7) |
| `apps/admin/src/catalog/ui/services-list-panel.tsx`, `services-table.tsx`, `service-table-row.tsx` | two columns and the closed mark (P-6) |
| `apps/admin/src/catalog/ui/service-edit-panel.tsx` | passes the category query to the edit form |
| `packages/i18n/src/catalog-services.ts` | the new ar and en keys |
| tests | extend `ui/service-form.spec.tsx` and `api/use-services.spec.tsx`; new `api/use-service-categories.spec.tsx` and a services list spec |

## Tests (visible outcomes, `CLAUDE.md` §9, PP-7.2)

- The form: the duration field error is visible for `0`, `601`, `90.5` and `abc`, and a blank saves as no duration;
  the picker offers only the open categories it was given; the edit form shows a closed current category selected with
  its closed mark; with a refused category list the picker is replaced by the read-only text.
- The hooks: the create and update bodies carry both fields, and `category_id` is absent (not `null`) on the refused
  path; the category hook follows `next_cursor` across pages.
- The list: the duration and category columns render, with the closed mark; choosing a category in the filter renders
  only the rows of the filtered page and resets to the first page.

## Delivery

Implementer: Kimi (`kimi-code-plan-global/k3.1-pro#high`), pipeline §4. Size: 350 to 500 lines with tests. The journey
doc 29 update follows in its own docs PR (pipeline step 14).
