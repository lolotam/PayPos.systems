# 91 · Stop and resume selling a package type — إيقاف بيع نوع باقة واستئنافه

**Status / الحالة:** shipped in #814 (33b-a: the pure selling-state rule), #1042 (33b-1: the selling state on a
package type, and the sale worker refusing a stopped type), #1055 (33b-2: the stop and resume routes) and #1067
(33b-3: the controls on the package types screen, with protection for an open editor), all merged (spec 058 row
33b). **Runs on staging** on `/catalog/package-types` ([37](37-package-types.md)); needs the `catalog` feature. It
only hides the type from new sales ([86](86-sell-package.md)); packages already sold are untouched.

**Before you start / قبل ما تبدأ:**
- Everything of [37](37-package-types.md), with at least one package type.
- The **Owner** or a manager with **إدارة أنواع باقات النشاط** / **Manage business package types**; a user with only
  **قراءة أنواع باقات النشاط** / **Read business package types**.
- A customer who already bought this package type ([86](86-sell-package.md)).

## العربي

1. **الزرار:** افتح **أنواع الباقات** ← في عمود **البيع** لكل نوع زرار **إيقاف البيع**.
2. **أوقف:** دوس **إيقاف البيع** ← الزرار بيتقفل لحظة التنفيذ، وبعدها بيظهر على النوع **البيع متوقف** والزرار بقى
   **استئناف البيع**.
3. **اختفى من البيع:** في شاشة **بيع باقة** ([86](86-sell-package.md)) النوع ده مش في القائمة. ولو كان فيه طلب بيع
   داخل على النوع ده ← بيترفض: **الباقة دي متوقف بيعها.**
4. **اللي اتباع ما اتأثرش:** العميلة اللي اشترت النوع ده قبل كده تستخدم جلساتها ([87](87-redeem-package-session.md))
   وباقتها تتمدد ([88](88-extend-package.md)) وتترد ([89](89-refund-package-sessions.md)) عادي.
5. **استأنف:** دوس **استئناف البيع** ← **البيع متوقف** تختفي، والنوع يرجع في شاشة البيع.
6. **قراءة بس:** المستخدم اللي معاه القراءة بس بيشوف **البيع متوقف** من غير أي زرار.
7. **وإنت بتعدّل:** لو نافذة تعديل النوع مفتوحة وفيها تعديل ما اتحفظش، وقفت أو استأنفت البيع ← التعديل المكتوب بيفضل
   زي ما هو، والحفظ بعدها بيتم على آخر نسخة من النوع.
8. **اتنين مع بعض:** مدير تاني غيّر النوع قبلك ← **عدّل مدير آخر نوع الباقة. أعد التحميل قبل الحفظ.**
9. **نفس الحالة:** إيقاف نوع متوقف بالفعل (API) ← **الباقة بالفعل في حالة البيع دي.**

**ممنوع يحصل:**
- نوع متوقف يتباع.
- الإيقاف يغيّر أو يلغي باقة اتباعت قبل كده، أو يمنع استخدام جلساتها.
- الإيقاف يمسح تعديل مفتوح ما اتحفظش.
- مستخدم من غير **إدارة أنواع باقات النشاط** يوقف أو يستأنف.
- إيقاف أو استئناف من غير سطر في سجل التدقيق (قبل وبعد).

## English

1. **The button:** open **Package types** → in the **Selling** column each type has a **Stop selling** button.
2. **Stop:** click **Stop selling** → the button is disabled while the request runs, then the type shows **Not on
   sale** and the button reads **Resume selling**.
3. **Gone from the sale screen:** on **Sell a package** ([86](86-sell-package.md)) the type is no longer listed. A
   sale request already on its way for that type is refused: **This package is not on sale.**
4. **Sold packages are untouched:** a customer who bought this type before still uses her sessions
   ([87](87-redeem-package-session.md)), and her package can be extended ([88](88-extend-package.md)) and refunded
   ([89](89-refund-package-sessions.md)) as usual.
5. **Resume:** click **Resume selling** → **Not on sale** disappears and the type is back on the sale screen.
6. **Read only:** the user with only the read permission sees **Not on sale** with no button.
7. **While editing:** if the type's edit panel is open with unsaved changes and you stop or resume selling → the
   typed changes stay as they are, and the save that follows uses the type's latest revision.
8. **Two at once:** another manager changed the type first → **Another manager changed this package type. Reload
   before saving.**
9. **The same state:** stopping a type that is already stopped (API) → **This package is already in that selling
   state.**

**Must NOT happen:**
- A stopped type sold.
- Stopping changing or cancelling a package already sold, or blocking the use of its sessions.
- Stopping wiping an open, unsaved edit.
- A user without **Manage business package types** stopping or resuming.
- A stop or a resume with no audit row (before and after).

## For an agent

- **Screen:** `/catalog/package-types` (local `http://localhost:3001`, staging
  `https://app.staging.pospay.systems`); components `apps/admin/src/catalog/ui/package-type-selling-toggle.tsx` and
  `package-type-table-row.tsx`. Text in `packages/i18n/src/catalog-package-types.ts` (`selling`, `notOnSale`,
  `stopSelling`, `resumeSelling`).
- **API** (`apps/api/src/modules/catalog/http/package-types.controller.ts`, `manage:package-types:business` + the
  `catalog` feature): `POST /v1/businesses/<BUSINESS_ID>/package-types/<PACKAGE_TYPE_ID>/stop-selling` and
  `…/resume-selling`, body `{ expected_revision }`; the answer is the type's detail with `selling_stopped_at`.
- **Errors:** `PACKAGE_TYPE_SELLING_UNCHANGED` · `PACKAGE_TYPE_REVISION_CONFLICT` · `PACKAGE_TYPE_NOT_SELLABLE`
  (on a sale).
- **Assertions:** the flag affects only new sales and the sale picker (spec 058 FR-003); no event is emitted
  (FR-002); the audit entry has before and after.
- **Sources:** `docs/specs/058-packages-sell-redeem/spec.md` (FR-001 … FR-003, row 33b),
  `docs/specs/058-packages-sell-redeem/plan-33b.md`.
