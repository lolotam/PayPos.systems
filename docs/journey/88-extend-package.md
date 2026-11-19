# 88 · Extend a package's expiry — تمديد صلاحية الباقة

**Status / الحالة:** shipped in #975 (row 45: extending a sold or imported package, with its history), #985
(45-ui: the extend dialog and the extension history) and #1045 (45-ui-2: the reason shown in the history, and the
**تمديد** / **Extend** button driven by the server), all merged (spec 058 row 45). **Runs on staging** inside the
package detail that opens under the **من الباقة** / **From package** toggle of the recording screen
([87](87-redeem-package-session.md)); needs the `orders` feature. Extending is free: no amount, no payment, no
change to sessions or values.

**Before you start / قبل ما تبدأ:**
- Everything of [87](87-redeem-package-session.md), with a customer's package chosen so that its detail is open.
- سارة (Sara), a manager with **تمديد صلاحية الباقة** / **Extend package expiry** on Salmiya; هبة (Heba), a
  receptionist without it.

## العربي

1. **الزرار:** سارة تفتح تفاصيل الباقة ← زرار **تمديد**. عند هبة الزرار مش ظاهر (السيرفر هو اللي بيقول مين يقدر).
2. **النافذة:** تدوس **تمديد** ← **تمديد الباقة** وفيها «تاريخ الانتهاء الحالي: …»، وخانة **تاريخ الانتهاء الجديد**،
   وخانة **السبب** («اكتب سبب تمديد الباقة (من ١ إلى ٥٠٠ حرف).»).
3. **مدّد:** تختار تاريخ بعد الحالي، وتكتب السبب، وتدوس **تمديد الباقة** ← **جارٍ الحفظ…** وبعدها **تم تمديد
   الباقة.** وتاريخ الانتهاء الجديد ظاهر في الباقة.
4. **سجل التمديدات:** في **سجل التمديدات** سطر جديد: «من … إلى …»، و«تم التمديد في …»، و«السبب: …». لو مفيش ← **لا
   توجد تمديدات بعد.**
5. **من غير سبب:** ← **اكتب سبب التمديد.** وسبب أطول من 500 حرف ← **سبب التمديد لا يمكن أن يتجاوز ٥٠٠ حرف.**
6. **تاريخ مش بعد الحالي:** ← **تاريخ الانتهاء الجديد لازم يكون بعد التاريخ الحالي.**
7. **أبعد من سنتين:** ← **تاريخ الانتهاء الجديد لا يمكن أن يتجاوز سنتين تقويميتين من اليوم.**
8. **حد مدّدها قبلك:** لو التاريخ اتغيّر وإنت فاتح النافذة ← **تاريخ انتهاء الباقة اتغيّر. التاريخ الحالي الآن …. راجع
   التاريخ الجديد وحاول تاني.**
9. **النت قطع:** ← **تعذّر الوصول إلى الخادم. أعد نفس المحاولة.** وإعادة المحاولة ما بتعملش تمديد تاني.
10. **من غير صلاحية:** طلب تمديد من مستخدم ملوش الصلاحية ← **غير مسموح لك بتمديد هذه الباقة.**

**ممنوع يحصل:**
- تمديد يقصّر الصلاحية، أو يعدّي سنتين من النهارده.
- تمديد يغيّر عدد الجلسات أو قيمها أو المبلغ المدفوع.
- تمديدين من ضغطتين أو من إعادة محاولة.
- سبب التمديد يظهر في سجل التدقيق أو في اللوج (بيتحفظ في صف التمديد بس).
- تمديد باقة من فرع أو شركة تانية.

## English

1. **The button:** Sara opens the package's detail → an **Extend** button. Heba does not see it (the server decides
   who may).
2. **The dialog:** she clicks **Extend** → **Extend package** with "Current expiry: …", a **New expiry date** field
   and a **Reason** field ("Explain why the package is being extended (1–500 characters).").
3. **Extend:** she picks a date after the current one, writes the reason and clicks **Extend package** →
   **Saving…**, then **Package extended.**, and the package shows the new expiry.
4. **Extension history:** **Extension history** has a new row: "From … to …", "Extended at …" and "Reason: …". With
   none → **No extensions yet.**
5. **No reason:** → **Enter a reason.** A reason over 500 characters → **The reason cannot exceed 500 characters.**
6. **A date not after the current one:** → **The new expiry must be later than the current expiry.**
7. **More than two years:** → **The new expiry cannot be more than two calendar years from today.**
8. **Someone extended it first:** if the expiry changed while the dialog was open → **The package expiry changed.
   Current expiry is now …. Review the new date and try again.**
9. **Network failure:** → **The server could not be reached. Retry the same attempt.**, and the retry never extends
   twice.
10. **No permission:** an extension by a user without the permission → **You are not allowed to extend this
    package.**

**Must NOT happen:**
- An extension that shortens the validity, or goes beyond two years from today.
- An extension changing the number of sessions, their values or the price paid.
- Two extensions from a double click or a retry.
- The reason in the audit log or a technical log (it is stored on the extension row only).
- A package of another branch or company extended.

## For an agent

- **Screen:** `/orders/service-sessions/new`, inside the package detail
  (`apps/admin/src/orders/ui/package-redemption-history.tsx` shows the button when the detail read returns
  `can_extend`); dialog `extend-package-dialog.tsx` and `extend-package-form.tsx`; history
  `package-extension-history.tsx`. Text in `packages/i18n/src/catalog-package-extension.ts`.
- **API:** `POST /v1/businesses/<BUSINESS_ID>/branches/<BRANCH_ID>/packages/<ENTITLEMENT_ID>/extensions`
  (`apps/api/src/modules/orders/http/package-extension.controller.ts`), `extend:packages:branch` + the `orders`
  feature, with an `Idempotency-Key`.
- **Errors:** `PACKAGE_EXPIRY_STALE` · `PACKAGE_EXTENSION_NOT_LATER` · `PACKAGE_EXTENSION_TOO_LONG` ·
  `PACKAGE_NOT_FOUND` · `FORBIDDEN` 403.
- **Assertions:** one `package_extensions` row per extension; no event is emitted and no slot changes (spec 058
  FR-043); the reason is absent from the audit entry (FR-044).
- **Sources:** `docs/specs/058-packages-sell-redeem/spec.md` (FR-040 … FR-044, row 45),
  `docs/specs/058-packages-sell-redeem/plan-45.md`, `plan-45-ui.md`, `plan-45-ui-2.md`.
