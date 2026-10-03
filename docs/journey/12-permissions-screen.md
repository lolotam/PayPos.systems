# 12 · The permissions screen — شاشة الصلاحيات

**Status / الحالة:** shipped in #73 (PR 7). Local only (admin not deployed, issue #54). Your decisions of 2026-10-03
apply: the 13 final roles, editing only within the editor's own permissions, one current decision per
**membership**, permission and scope, with history.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), then **`pnpm db:seed`** once after #73 (it loads the new
  `read:memberships:company` permission and the owner's grant; `db:migrate` and `demo:seed` do not). Without it an owner
  gets 403.
- Signed in to the admin with a company chosen ([01](01-admin-sign-in-and-totp.md), [02](02-admin-workspace-selector.md)).
  Your membership needs `read:memberships:company` to open the screen and `manage:memberships:company` to edit (the
  owner role has both).
- In the same company: one ordinary member, and one **owner** who also has a second, lower membership (for step 7).
  Ask Claude to prepare them.

## العربي

1. من القائمة الجانبية دوس **الصلاحيات** (عليها نقطة برتقالي وأنت فيها) ← قائمة العضويات (**العضوية**). لو مفيش: **لا توجد عضويات.**
2. دوس **عرض** على العضوية ← تظهر **الدور** باسمه بالعربي (مثلاً **مدير فرع**)، و**مدة العضوية**، و**صلاحيات الدور الافتراضية**،
   و**استثناءات الشخص**، و**الاستثناءات المنتهية**.
3. **استثناء جديد** (على العضو العادي): اختار **الصلاحية** (من صلاحيات الشركة بس)، **القرار** (**سماح** أو **منع**)،
   **النطاق** (**الشركة** / **النشاط** / **الفرع**) ومعرّفه، **السبب** (إلزامي)، و**انتهاء الصلاحية** (اختياري، UTC، في
   المستقبل) ← **حفظ الاستثناء** ← **حُفظ الاستثناء.** والسطر يظهر تحت **استثناءات الشخص** وعليه **سماح** أو **منع**.
4. **تغيير القرار:** احفظ قرار تاني لنفس **العضوية** والصلاحية والنطاق ← القديم يتنقل لـ **الاستثناءات المنتهية** والجديد هو
   الساري. (عضوية تانية لنفس الشخص لها قراراتها المستقلة.)
5. **سحب:** على استثناء ساري دوس **سحب الاستثناء** واكتب سبب ← **تم سحب الاستثناء.** وينتقل للمنتهية. الاستثناءات المنتهية
   ما عليهاش زرار سحب.
6. **صلاحية مش عندك:** حاول تدي صلاحية إنت نفسك مش معاك ← **لا تملك هذه الصلاحية حاليًا على النطاق المطلوب**.
7. **صاحب الشركة محمي:** على أي عضوية لشخص هو owner — حتى عضويته الأقل —: إضافة **منع**، أو تغيير أو سحب **سماح** موجود
   ← **صلاحيات صاحب الشركة محمية من هذا التغيير**.
8. **نفسك:** افتح عضويتك أنت ← الشاشة قراءة بس: **لا يمكنك تعديل صلاحيات هذه العضوية.** (نفس الرسالة لو مش معاك صلاحية التعديل.)
9. كل حفظ أو سحب بيتسجل في سجل التدقيق (مين، إيه، قبل وبعد، والسبب).
10. **فحوصات من الـ API بس** (مش من الشاشة): تعديل عضوية تانية ليك ← **لا يمكنك تعديل صلاحيات عضويتك الشخصية** (403)؛
    سحب استثناء منتهي ← **هذا الاستثناء انتهى بالفعل** (409)؛ تعارض في نفس اللحظة ← **تعارض التغيير مع عملية أخرى ولم
    يُحفظ. حاول مرة أخرى.** (409، مش خطأ سيرفر).

**ممنوع يحصل:** حد يدّي صلاحية مش معاه؛ حد يعدّل صلاحياته هو؛ صاحب الشركة يتقفل برّه إدارة الصلاحيات؛ قرارين ساريين لنفس
العضوية والصلاحية والنطاق؛ عضويات أو استثناءات شركة تانية تظهر.

## English

1. Sidebar **Permissions** (الصلاحيات) (an orange dot marks the current page) → the membership list (**Membership**). None: "No memberships found."
2. Press **View** (عرض) on a membership → **Role** with its localized name (for example **Branch Manager**), **Membership window**,
   **Role defaults**, **Personal overrides** and **Ended overrides**.
3. **New override** (on the ordinary member): **Permission** (tenant permissions only), **Decision** (**Allow** /
   **Deny**), **Scope** (**Company** / **Business** / **Branch**) and its identifier, **Reason** (required), optional
   **Expiry (UTC, optional)** in the future → **Save override** → "Override saved." and the row appears under
   **Personal overrides** with an **Allow** or **Deny** badge.
4. **Changing the decision:** save another decision for the same **membership**, permission and scope → the old one
   moves to **Ended overrides**; only the new one is current. (Another membership of the same person keeps its own
   decisions.)
5. **Revoke:** on a current override, **Revoke override** with a reason → "Override revoked." and it moves to the ended
   list. Ended overrides have no revoke button.
6. **A permission you do not hold** → "You do not currently hold this permission over the target scope".
7. **Owners are protected:** on any membership of a person who is an owner — even their lower one —, adding a **Deny**,
   or replacing or revoking an existing **Allow** → "Owner permissions are protected from this change".
8. **Yourself:** open your own membership → read-only: "You cannot edit this membership’s permissions." (Same message
   without the edit permission.)
9. Every save and revoke is audited (who, what, before/after, reason).
10. **API-only checks** (not reachable from the screen): editing another membership of your own → "You cannot edit
    permissions on your own membership" (403); revoking an ended override → "This override has already ended" (409); a
    clash with a simultaneous change → "The change conflicted with another transaction and was not saved. Please
    retry." (409, never a server error).

**Must NOT happen:** granting a permission you do not hold; editing your own permissions; an owner locked out of
permission management; two current decisions for one membership, permission and scope; another company's memberships
or overrides visible.

## For an agent

- Admin at `http://localhost:3001/permissions`; find controls by visible text (Arabic or English above).
- API (session cookie + `x-company-id`): `GET /v1/permissions/memberships` and
  `GET /v1/permissions/memberships/{membershipId}` → 200;
  `POST /v1/permissions/memberships/{membershipId}/overrides` with the strict body
  `{ permission_code, effect: "ALLOW"|"DENY", scope_type: "COMPANY"|"BUSINESS"|"BRANCH", scope_id, reason, expires_at }`
  (`expires_at` is a future UTC timestamp or **`null`**, never omitted) → 201;
  `POST /v1/permissions/memberships/{membershipId}/overrides/{overrideId}/revoke` with `{ reason }` → 200.
- Errors use the standard envelope: 400 (invalid body), 401 (no session), 403 (not held / self edit / owner protected /
  scope outside reach), 404 (unknown membership or override), 409 (ended / retry). Shapes: `packages/contracts/src/identity/permissions.ts`.
- Role defaults are read-only here; default bundles per role arrive with PR 7a.
