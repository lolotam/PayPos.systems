# Plan: 32b-cat-3b, single-service close and reopen, and the branch context of categories

Roadmap row `32b-cat-3b` («قفل وفتح خدمة واحدة وإعدادات الفروع من شاشة الخدمة») of [spec 072](spec.md), split from
`32b-cat-3` on 2026-11-14 (PP-192). `32b-cat-3a` is merged (#1060) and its plan is [plan-32b-cat-3.md](plan-32b-cat-3.md).
**Admin only. No API change, no contract change, no migration, no new permission.**

This is a plan (PP-204). It holds no production code and no tests.

## Prerequisites (checked on `origin/main` 995361e6c)

- **The row is not built.** No commit or PR on `main` names `32b-cat-3b`; #1060 delivered `3a` only.
- **The routes exist and are in the generated admin client** (`apps/admin/src/shared/api/schema.d.ts`):
  - `POST /v1/businesses/{businessId}/services/{serviceId}/close` and `…/reopen`;
  - `GET` and `POST /v1/businesses/{businessId}/branches/{branchId}/service-categories`;
  - `PATCH …/branches/{branchId}/service-categories/{categoryId}`;
  - `PUT …/branches/{branchId}/service-categories/{categoryId}/state`.
- **Contracts** (`packages/contracts/src/catalog/`): `closeServiceInput` and `reopenServiceInput` in `service.ts`;
  `createBranchServiceCategoryInput`, `renameServiceCategoryInput`, `setServiceCategoryBranchStateInput`,
  `serviceCategoryBranchPage` and `serviceCategoryBranchStateResult` in `service-category.ts`.
- **Owner answers:** SI-Q17 to SI-Q24 cover this row and all are answered. Nothing in `owner-questions.ar.md` is
  `PENDING`, and this plan adds no owner question.
- **Deferrals:** no entry in `docs/owner-decisions.ar.md` names `32b-cat-3b`.
- **Admin today:**
  - the service panel (`ui/service-edit-panel.tsx`) edits a service and has no close or reopen;
  - the category page (`pages/service-categories-page.tsx`) reads only the business routes. A branch manager does
    not hold `read:service-categories:business` (SI-Q22), so that page answers them with a 403 message today.

## What the API gives the screen

| Call | Body | Answer | Refusals |
|---|---|---|---|
| `POST …/services/{serviceId}/close` | `{ expected_revision }` | 200 `Service` | `SERVICE_NOT_FOUND` (404), `SERVICE_ALREADY_CLOSED`, `SERVICE_REVISION_CONFLICT` (409) |
| `POST …/services/{serviceId}/reopen` | `{ expected_revision }` | 200 `Service` | `SERVICE_NOT_FOUND` (404), `SERVICE_NOT_CLOSED`, `SERVICE_CATEGORY_CLOSED`, `SERVICE_REVISION_CONFLICT` (409) |
| `GET …/branches/{branchId}/service-categories?view=in_use\|available&cursor&limit` | | 200 page of `{ id, name_en, name_ar, visibility, owner_branch_id, closed_at, revision, setting_state, setting_revision }` | `SERVICE_CATEGORY_NOT_FOUND` (404) |
| `POST …/branches/{branchId}/service-categories` | `{ name_en, name_ar, visibility }` | 201 `ServiceCategory` | `SERVICE_CATEGORY_NAME_INVALID`, `SERVICE_CATEGORY_NAME_TAKEN` |
| `PATCH …/branches/{branchId}/service-categories/{categoryId}` | `{ name_en, name_ar, visibility?, expected_revision }` | 200 `ServiceCategory` | `SERVICE_CATEGORY_VISIBILITY_FIXED`, `SERVICE_CATEGORY_REVISION_CONFLICT`, `SERVICE_CATEGORY_NAME_TAKEN`, `SERVICE_CATEGORY_NOT_FOUND` |
| `PUT …/branches/{branchId}/service-categories/{categoryId}/state` | `{ state: 'ENABLED'\|'HIDDEN', expected_revision }` | 200 branch item | `SERVICE_CATEGORY_CLOSED` (enabling a closed category), `SERVICE_CATEGORY_REVISION_CONFLICT`, `SERVICE_CATEGORY_NOT_FOUND` |

- Both service routes are synchronous. There is no 202 path and no job to poll.
- The service routes need `close:services:business` **and** `read:services:business`.
- In the state write, `expected_revision` is the item's `setting_revision`, and `null` when the branch has no
  settings row yet.
- Every message for these codes already exists in `packages/i18n` (`catalog-services.ts`,
  `catalog-service-categories.ts`) and reaches the screen in the error envelope (`envelopeMessage`). No error copy
  is added.

## Scope: three PRs

The spec row estimates 500 to 600 lines. `3a` was planned at about 910 and delivered about 1,540, so this plan
counts per file. The row is about **1,000 production lines**, split by what a manager does on one screen:

| PR | What the manager gets | Production | Tests |
|---|---|---|---|
| `32b-cat-3b-1` | Close and reopen one service on the service panel | ~165 | ~260 |
| `32b-cat-3b-2` | The category page for one branch: «مستخدمة» and «متاحة» lists (read only) | ~420 | ~330 |
| `32b-cat-3b-3` | Branch actions: hide, enable, create shared or private, rename, make shared | ~420 | ~420 |

- `3b-1` touches the services screen only and can run beside `3b-2`.
- `3b-3` stacks on `3b-2`.
- Each PR stands alone: after `3b-2` a branch manager sees their categories instead of a 403 message.

## Decisions

### `3b-1`: single-service close and reopen

| # | Decision | Why |
|---|---|---|
| S-1 | **Where.** A new block `ServiceClosingToggle` on the service panel, above the edit form. It shows a state badge («مفتوحة» or «مقفولة», the existing `catalogServiceCategories.open` and `.closed` keys) and one button: «قفل الخدمة» on an open service, «فتح الخدمة» on a closed one. | Spec row part 1: «on the service panel». |
| S-2 | **Close asks once, reopen does not.** «قفل الخدمة» opens an inline confirmation (the `3a` pattern, no dialog): «الخدمة مش هتتعرض لأوردر جديد في كل الفروع. الأوردرات القديمة ما بتتغيرش.» with «تأكيد» and «إلغاء». «فتح الخدمة» posts at once. | Closing stops selling in every branch at once (SI-Q18); reopening only restores. This is a screen choice, not a business rule. |
| S-3 | **The body** is `{ expected_revision: record.revision }` from the detail the panel already reads. | The contract; the same revision rule as the edit form. |
| S-4 | **On 200** the hook writes the answer into the detail key `['services', companyId, businessId, userId, 'detail', serviceId]` with `setQueryData`. It then invalidates the services list key and the category key root (`serviceCategoryKey`). A `role="status"` line shows «اتقفلت الخدمة» or «اتفتحت الخدمة». | `EditServiceForm` is keyed on `id:revision`, so it must see the new revision. The category detail's `open_service_count` changed. |
| S-5 | **Unsaved edits are dropped by a close or reopen**, because the new revision remounts the form. The button is disabled while a save is pending. | The same effect as the panel's existing «إعادة التحميل» button. |
| S-6 | **Refusals.** Every refusal shows `envelopeMessage(error, locale)` in a `role="alert"` line. `SERVICE_REVISION_CONFLICT`, `SERVICE_ALREADY_CLOSED` and `SERVICE_NOT_CLOSED` also invalidate the detail key, so the badge and the button show the current state. `SERVICE_CATEGORY_CLOSED` (a refused reopen) and 403 show the message only. | The server decides; the admin hides no button by permission (the `3a` rule, U-9). |
| S-7 | **The edit form is unchanged.** A closed service stays editable: `update-service` does not refuse it. | No API change. |

### `3b-2`: the branch views

| # | Decision | Why |
|---|---|---|
| B-1 | **One page, a scope select.** `/catalog/categories` gains a select above the list: «كل النشاط» plus one option per branch of `business.branches`. «كل النشاط» renders the `3a` page unchanged. A branch renders the new branch section, keyed by `branchId`. The select is hidden when the business has no branch. | Spec row part 2: «for a branch the user manages». The precedent is `settings/alert-rules/ui/scope-selector.tsx`. |
| B-2 | **The first choice.** When `workspace.company.scope === 'BRANCH'`, the page opens on `workspace.branch`, or the first branch of the business when none is remembered. Otherwise it opens on «كل النشاط». Both kinds of option are always offered. | The scope picks a view, it grants nothing: the API checks the membership on every call. A branch manager no longer lands on a 403. |
| B-3 | **A new shell, `3a` untouched.** A new `pages/service-categories-screen.tsx` holds the select and renders either `ServiceCategoriesPage` or the branch section. `_frame/service-categories-route.tsx` renders the shell. | `ServiceCategoriesPage` is 233 lines and its function is at the 60-line limit. Not mounting it in branch scope also stops its business list read, which would 403 every 30 seconds. |
| B-4 | **Two tabs:** «مستخدمة» (`view=in_use`, the default) and «متاحة» (`view=available`), with cursor paging and `limit=20` as on the `3a` list. Changing tab or scope resets the cursor. | The contract's two views. |
| B-5 | **The row** shows the name in the page language, the visibility badge (existing keys), and a second badge from a pure function `branchCategoryMark(item, branchId)`: «بتاع الفرع ده» when `owner_branch_id === branchId`, «مخفي عندك» when `setting_state === 'HIDDEN'`, otherwise none. | A manager must tell their own private category from another branch's, and a hidden category from a never-enabled one. |
| B-6 | **Reads from the list item only.** The branch section never calls the business list or the business detail. | Both need `read:service-categories:business`, which a branch manager lacks. `ServiceCategoryPanel` and `useServiceCategoryDetail` are not reused here. |
| B-7 | **Query keys** sit under the `3a` root: `[...serviceCategoryKey(companyId, businessId, userId), 'branch', branchId, 'list', view, cursor]`, with `refetchInterval: 30_000`. | A business-wide close, reopen or rename already invalidates that root, so the branch lists follow it. |
| B-8 | **Errors.** A list error shows `envelopeMessage` in the `EmptyState` danger pattern of the `3a` list panel; an empty page shows `catalogServiceCategories.empty`. | Same pattern as `service-categories-list-panel.tsx`. |

### `3b-3`: the branch actions

| # | Decision | Why |
|---|---|---|
| A-1 | **Which actions a row offers** comes from one pure function `branchCategoryActions(item, branchId, view)` in `model/service-category-branch.ts`: `hide` when `view === 'in_use'`; `enable` when `view === 'available'`; `rename` and `share` when `visibility === 'BRANCH' && owner_branch_id === branchId`. | Any other rename or share is `SERVICE_CATEGORY_VISIBILITY_FIXED` (SI-Q23, SI-Q25). The rule is tested with no rendering. |
| A-2 | **Hide and enable** are one button on the row («إخفاء من الفرع» or «تفعيل في الفرع»), each row with its own mutation (the `package-type-selling-toggle.tsx` pattern). The body is `{ state, expected_revision: item.setting_revision }`. On 200 the hook invalidates `[...root, 'branch', branchId]`, so the row moves to the other tab. | SI-Q20 (enable without asking), SI-Q22 and SI-Q24 (hide in this branch only, own private ones included). |
| A-3 | **No confirmation for hide or enable.** | Neither touches a service or another branch (SI-Q21), and each is undone from the other tab. |
| A-4 | **Refusals of the state write** show `envelopeMessage` under the button and invalidate the branch lists (`SERVICE_CATEGORY_REVISION_CONFLICT`, `SERVICE_CATEGORY_CLOSED`, `SERVICE_CATEGORY_NOT_FOUND`). 403 shows the message only. | A stale row must be replaced by the current one. |
| A-5 | **Create.** «إضافة تصنيف» opens a form: both names (the existing `ServiceCategoryNameFields`) and a required choice «خاص بالفرع ده» (`BRANCH`) or «مشترك لكل الفروع» (`BUSINESS`). **No option is preselected.** The form validates with `createBranchServiceCategoryInput`. On 201 the section shows «تمت إضافة التصنيف.» and returns to «مستخدمة». | SI-Q19: the creator picks. The spec names no default, so the screen does not choose one. |
| A-6 | **Name already taken.** `SERVICE_CATEGORY_NAME_TAKEN` shows its message plus a button «شوف التصنيفات المتاحة» that switches to the «متاحة» tab. | Spec: «the second is offered the existing category to enable instead». The answer carries no category id, so the screen cannot point at the row (see «Decision for the manager»). |
| A-7 | **Rename** (own private categories only) opens the same form without the visibility choice and sends `{ name_en, name_ar, expected_revision: item.revision }`, with no `visibility` key. `SERVICE_CATEGORY_REVISION_CONFLICT` shows the existing «إعادة التحميل» action, which refetches the branch list. | The contract; `ServiceCategoryFormFeedback` already carries this action. |
| A-8 | **Make shared** is a button «خليه مشترك لكل الفروع» in the same panel with an inline confirmation: «بعد ما يبقى مشترك مش هيرجع خاص تاني، وتعديل اسمه هيبقى من مستوى النشاط.» It sends the item's current names, `visibility: 'BUSINESS'` and `expected_revision`. | SI-Q23: sharing goes one way, so the manager is told before it happens. |
| A-9 | **Invalidation** after create, rename and share: the category key root (which holds the branch lists) and, for rename and share, the services key root. | Category labels on the services list; the same rule as the `3a` rename. |

## Files and line budgets (production, hand-written)

Paths are under `apps/admin/src/catalog/` unless they start with `apps/` or `packages/`.

### `3b-1` (~165)

| File | New or edit | Lines |
|---|---|---|
| `api/use-service-closing.ts`: `useServiceClosing(companyId, businessId, userId, serviceId)`, one mutation taking `{ action, expectedRevision }` (S-3, S-4, S-6) | new | ~65 |
| `ui/service-closing-toggle.tsx` (S-1, S-2, S-5, S-6) | new | ~75 |
| `ui/service-edit-panel.tsx`: render the toggle when `record.data` is present, pass `save.isPending` | edit | +9 |
| `packages/i18n/src/catalog-services.ts`: 6 keys in each language | edit | +12 |

### `3b-2` (~420)

| File | New or edit | Lines |
|---|---|---|
| `pages/service-categories-screen.tsx` (B-1, B-2, B-3) | new | ~55 |
| `ui/service-category-scope-select.tsx` | new | ~40 |
| `api/use-branch-service-categories.ts`: the key helper and the list read (B-7) | new | ~60 |
| `model/service-category-branch.ts`: `branchCategoryMark` (B-5) | new | ~25 |
| `pages/branch-service-categories-section.tsx`: tabs, cursor, list (B-4) | new | ~80 |
| `ui/branch-service-category-view-tabs.tsx` | new | ~32 |
| `ui/branch-service-categories-table.tsx` (B-8) | new | ~55 |
| `ui/branch-service-category-row.tsx` (B-5) | new | ~45 |
| `apps/admin/app/(dashboard)/_frame/service-categories-route.tsx`: render the shell, pass `workspace.company.scope` and `workspace.branch?.id` | edit | +6 |
| `packages/i18n/src/catalog-service-category-branches.ts`: a new namespace `catalogServiceCategoryBranches`, 9 keys in each language | new | ~24 |
| `packages/i18n/src/ar.ts` and `en.ts`: import and register the namespace | edit | +4 |

### `3b-3` (~420)

| File | New or edit | Lines |
|---|---|---|
| `model/service-category-branch.ts`: `branchCategoryActions` (A-1) | edit | +25 |
| `api/use-branch-service-category-state.ts` (A-2, A-4) | new | ~45 |
| `ui/branch-service-category-state-button.tsx` | new | ~50 |
| `api/use-branch-service-category-save.ts`: create, rename and share (A-5, A-7, A-8, A-9) | new | ~85 |
| `ui/branch-service-category-form.tsx`: create and rename modes | new | ~85 |
| `ui/service-category-visibility-field.tsx` (A-5) | new | ~35 |
| `ui/branch-service-category-panel.tsx`: rename and make shared for an own private category (A-7, A-8) | new | ~70 |
| `pages/branch-service-categories-section.tsx`: the create button, the selected row, the «متاحة» jump (A-6) | edit | +25 |
| `ui/branch-service-category-row.tsx`: the state button and «إدارة» | edit | +12 |
| `packages/i18n/src/catalog-service-category-branches.ts`: 12 more keys in each language | edit | +24 |

No file goes over 300 lines and no function over 60. `ar.ts` (360) and `en.ts` (365) stay under the 400-line
error limit. Every new `model/` export carries an Arabic JSDoc; hooks and components follow the comment style of
the `3a` files beside them.

## Copy (new keys; en and ar)

`catalogServices` (`3b-1`):

| Key | en | ar |
|---|---|---|
| `closeService` | Close service | قفل الخدمة |
| `reopenService` | Reopen service | فتح الخدمة |
| `closeServiceConfirm` | The service will not be offered for a new order in any branch. Past orders do not change. | الخدمة مش هتتعرض لأوردر جديد في كل الفروع. الأوردرات القديمة ما بتتغيرش. |
| `closeServiceConfirmAction` | Confirm | تأكيد |
| `serviceClosed` | Service closed. | اتقفلت الخدمة. |
| `serviceReopened` | Service reopened. | اتفتحت الخدمة. |

`catalogServiceCategoryBranches` (`3b-2`):

| Key | en | ar |
|---|---|---|
| `scopeLabel` | Show categories for | عرض التصنيفات لـ |
| `scopeBusiness` | Whole business | كل النشاط |
| `tabInUse` | In use | مستخدمة |
| `tabAvailable` | Available | متاحة |
| `leadInUse` | Categories this branch uses in its lists and filters. | التصنيفات اللي الفرع ده بيستخدمها في قوايمه وفلاتره. |
| `leadAvailable` | Other categories of the business this branch can enable. | تصنيفات تانية في النشاط يقدر الفرع ده يفعّلها. |
| `ownedHere` | This branch's own | بتاع الفرع ده |
| `hiddenHere` | Hidden here | مخفي عندك |
| `branchColumn` | In this branch | في الفرع ده |

`catalogServiceCategoryBranches` (`3b-3`):

| Key | en | ar |
|---|---|---|
| `hide` | Hide from this branch | إخفاء من الفرع |
| `enable` | Enable in this branch | تفعيل في الفرع |
| `hidden` | Hidden from this branch. | اتخفى من الفرع ده. |
| `enabled` | Enabled in this branch. | اتفعّل في الفرع ده. |
| `visibilityChoice` | Who uses this category | مين يستخدم التصنيف ده |
| `visibilityPrivate` | This branch only | خاص بالفرع ده |
| `visibilityShared` | Shared with every branch | مشترك لكل الفروع |
| `visibilityRequired` | Choose who uses this category. | اختار مين يستخدم التصنيف. |
| `seeAvailable` | See available categories | شوف التصنيفات المتاحة |
| `share` | Share with every branch | خليه مشترك لكل الفروع |
| `shareConfirm` | A shared category never becomes private again, and it is renamed from the business level. | بعد ما يبقى مشترك مش هيرجع خاص تاني، وتعديل اسمه هيبقى من مستوى النشاط. |
| `shared` | The category is now shared with every branch. | التصنيف بقى مشترك لكل الفروع. |

Names, create, rename, cancel, reload and the saved lines reuse the existing `catalogServiceCategories` keys. No
string is hardcoded, and only logical CSS properties are used.

## Tests (visible outcomes, PP-7.2)

Each PR has its own fixtures file; `service-categories-page.fixtures.tsx` (332 lines) is not extended. A mock-call
assertion never stands alone. Both locales are checked, with the `dir`, as `services-list.spec.tsx` does.

**`3b-1`** (`ui/service-closing-toggle.spec.tsx`, `api/use-service-closing.spec.tsx`):

- An open service shows «مفتوحة» and «قفل الخدمة». After the confirmation and a 200, the panel shows «مقفولة»,
  «فتح الخدمة» and «اتقفلت الخدمة.»; the posted body carries the detail's `expected_revision`.
- «إلغاء» in the confirmation posts nothing and the badge stays «مفتوحة».
- A closed service reopens without a confirmation and shows «مفتوحة».
- **A refused reopen:** a 409 `SERVICE_CATEGORY_CLOSED` shows the envelope's message for the page language and
  the badge stays «مقفولة».
- A 409 `SERVICE_REVISION_CONFLICT` shows its message, and after the refetch the badge shows the server's state.
- A 403 shows the envelope message and the badge does not change.
- The hook spec: after a 200, the services list query is refetched and the row shows the «مقفولة» badge.

**`3b-2`** (`pages/service-categories-screen.spec.tsx`, `model/service-category-branch.spec.ts`):

- **A branch-scoped user** opens on their branch: the «مستخدمة» rows are shown and no request goes to the business
  list route.
- A business-scoped user opens on «كل النشاط» and sees the `3a` list; choosing a branch shows that branch's rows.
- «متاحة» shows only the `available` rows; another branch's private category shows «الفرع», and a hidden one shows
  «مخفي عندك».
- A category owned by the branch shows «بتاع الفرع ده».
- A 403 on the branch list shows the envelope message; an empty page shows the empty line.
- `branchCategoryMark` unit cases: owned, hidden, owned and hidden, neither.

**`3b-3`** (`pages/branch-service-categories-actions.spec.tsx`, `ui/branch-service-category-form.spec.tsx`,
`model/service-category-branch.spec.ts`):

- **A branch manager sees only the branch views and the enable and hide actions** on a shared category: no
  «تعديل اسم التصنيف», no «خليه مشترك لكل الفروع», no «قفل التصنيف».
- «إخفاء من الفرع» on an `in_use` row: after the 200 and the refetch, the row leaves «مستخدمة» and is listed under
  «متاحة» with «مخفي عندك». The body carries `expected_revision: null` for a row with no settings row.
- «تفعيل في الفرع» on another branch's private category moves it to «مستخدمة».
- A 409 `SERVICE_CATEGORY_CLOSED` on enable shows the envelope's message and the row is refetched.
- Create refuses a submit with no visibility choice («اختار مين يستخدم التصنيف.») and with an empty Arabic name.
- Create with «خاص بالفرع ده» posts `visibility: 'BRANCH'`, and the new row shows «بتاع الفرع ده».
- `SERVICE_CATEGORY_NAME_TAKEN` shows its message and «شوف التصنيفات المتاحة», which switches the tab.
- Rename is offered only on an own private row; the body has no `visibility` key.
- Make shared shows the one-way warning first; after the 200 the row shows «كل النشاط» and no longer offers rename.
- `branchCategoryActions` unit cases for each view, owner and visibility.

## Permissions

| Action | Permission (checked by the API only) | Default roles |
|---|---|---|
| Close or reopen one service | `close:services:business` and `read:services:business` | owner, general manager, business manager |
| Read the branch views | `read:service-categories:branch` | those three and the branch manager |
| Hide, enable, create from a branch, rename own private, make shared | `manage:service-categories:branch` | those three and the branch manager |

The admin hides no control by permission; a refused call shows the 403 envelope message. `close:services:business`
is never grantable to a cashier, a staff role or a device (SI-Q17, SI-Q26), and this row changes none of that.

## Stop line

Stop and report to the manager, without widening the PR, if any of these is needed:

- a change to `packages/contracts`, `apps/api`, `apps/worker`, `packages/db` or any migration;
- an edit to a `3a` file not listed above (`service-categories-page.tsx` and its hooks, panel and specs stay as they are);
- hiding a control by role or permission in the admin;
- a delivery heading past twice a PR's budget above: `3b-1` over ~330, `3b-2` or `3b-3` over ~840.

Out of scope, on purpose:

- **Make shared from the business page.** The business `PATCH` accepts it, but the spec row lists it under the
  branch context only.
- **The service picker for a branch-only reader.** `useOpenServiceCategories` keeps reading the business list; a
  role holding only `read:service-categories:branch` still gets no category picker.
- **A warning about packages** when a service closes (SI-Q28 is a later slice).
- **`pending_closing_id` on the list read** (already declined in the `3a` plan).

## Delivery

- **Implementation (PP-204):** the manager opens the implementer, GLM 5.3 flash, with `delegate_task`: one session
  and one worktree per PR. Each brief is under 400 lines and points at this file for the rest.
- **Order:** `3b-1` and `3b-2` can run in parallel (disjoint files, except `ar.ts` and `en.ts`, which only `3b-2`
  touches). `3b-3` branches from `3b-2`; retarget it before `3b-2`'s branch is deleted.
- **Guards (PP-198):** the implementer runs `clean-code-guard` and `test-guard` before handing back. Claude runs
  one `/code-review` on the full diff of each PR.
- **Local gates (CLAUDE.md §1 step 3):** `pnpm --filter @pospay/admin typecheck`, `lint` and the PR's own specs;
  `pnpm lint:docs`; `pnpm module-map:check`; prettier on the touched files. The row is done only when `ci-gate` is
  green on the exact head (PP-113).
- **No database lane, no migration, no staging snapshot.**
- **After the last merge:** `roadmap.json` marks `32b-cat-3b` done (CLAUDE.md §1 5c).

## Decision for the manager

1. **The row title against the spec.** The roadmap title says «إعدادات الفروع من شاشة الخدمة». The spec puts the
   branch context on the **category** screen, and no service has a branch setting: a category only groups, and a
   service sells in every branch (SI-Q21). This plan follows the spec. If Waleed meant a per-branch setting of a
   service, that is a new feature question, not this row.
2. **Three PRs, about 1,000 lines.** The spec's 500 to 600 does not hold once the files are counted.
   - **Lever:** `3b-2` and `3b-3` as one PR of about 840 lines is inside the PP-192 band (no money, no migration,
     no sensitive permission). It saves one review cycle and gives a larger diff.
   - **If `3b-3` grows:** split it at the state write (hide and enable, about 120 lines) against create, rename and
     make shared (about 300).
3. **Optional API gap (not in this plan):** `SERVICE_CATEGORY_NAME_TAKEN` carries no `details`. Adding
   `details.category_id` (about 15 API lines plus tests) would let the create form point at the existing category
   and offer «تفعيل» on the spot, which is what the spec's sentence describes. Recommendation: skip it for now; the
   jump to «متاحة» covers the case.
4. **Not verified:** whether the workspaces read narrows `business.branches` for a branch-scoped member. The plan
   works either way: with a full list, a branch the user does not manage answers 403 and the screen shows the
   message.
