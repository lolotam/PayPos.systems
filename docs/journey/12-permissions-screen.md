# 12 · The permissions screen — شاشة الصلاحيات

**Status / الحالة:** shipped in #73 (PR 7). Local only (admin not deployed, issue #54). Your decisions of 2026-10-03
apply: the 13 final roles, editing only within the editor's own permissions, one current decision per person and
permission with history.

**Before you start / قبل ما تبدأ:**
- [00 Local setup](00-local-setup.md), signed in to the admin with a company chosen ([01](01-admin-sign-in-and-totp.md),
  [02](02-admin-workspace-selector.md)).
- Your membership needs `read:memberships:company` to open the screen and `manage:memberships:company` to edit (the
  owner role has both).
- At least two other people in the company: one ordinary member, and one **owner** — ideally an owner who also has a
  second, lower membership (for step 8). Ask Claude to prepare them.

## العربي

1. من فوق دوس **الصلاحيات** ← قائمة العضويات (**العضوية**). لو مفيش: **لا توجد عضويات.**
2. اختار شخص ← تظهر **الدور** باسمه بالعربي (مثلاً **مدير فرع**)، و**مدة العضوية**، و**صلاحيات الدور الافتراضية**، و**استثناءات
   الشخص**، و**الاستثناءات المنتهية**.
3. **استثناء جديد:** اختار **الصلاحية** (من صلاحيات الشركة بس)، **القرار** (**سماح** أو **منع**)، **النطاق** (**الشركة** /
   **النشاط** / **الفرع**) ومعرّفه، **السبب** (إلزامي)، و**انتهاء الصلاحية** (اختياري، بتوقيت UTC، ولازم في المستقبل)
   ← **حفظ الاستثناء** ← **حُفظ الاستثناء.** ويظهر وعليه **ساري**.
4. **تغيير نفس القرار:** احفظ قرار تاني لنفس الشخص والصلاحية والنطاق ← القديم بيتنقل لـ **الاستثناءات المنتهية** والجديد
   هو الساري (مفيش قرارين في نفس الوقت).
5. **سحب:** **سحب الاستثناء** + سبب ← **تم سحب الاستثناء.** وينتقل للمنتهية. سحب استثناء منتهي ← **هذا الاستثناء انتهى بالفعل**.
6. **صلاحية مش عندك:** حاول تدي صلاحية إنت نفسك مش معاك ← **لا تملك هذه الصلاحية حاليًا على النطاق المطلوب**.
7. **نفسك:** افتح عضويتك أنت (أو أي عضوية تانية ليك) ← تعديلها مرفوض: **لا يمكنك تعديل صلاحيات عضويتك الشخصية**.
8. **صاحب الشركة:** حاول تحط **منع** على أي عضوية لشخص هو owner — حتى لو عضويته التانية أقل — ← **صلاحيات صاحب الشركة محمية
   من هذا التغيير**.
9. لو مش معاك صلاحية التعديل ← الشاشة بتبقى قراءة بس: **لا يمكنك تعديل صلاحيات هذه العضوية.**
10. لو حصل تعارض مع تغيير تاني في نفس اللحظة ← **تعارض التغيير مع عملية أخرى ولم يُحفظ. حاول مرة أخرى.** (ومش خطأ سيرفر).
11. كل حفظ أو سحب بيتسجل في سجل التدقيق (مين، إيه، قبل وبعد، والسبب).

**ممنوع يحصل:** حد يدّي صلاحية مش معاه؛ حد يعدّل صلاحياته هو؛ صاحب الشركة يتقفل برّه إدارة الصلاحيات؛ قرارين ساريين لنفس
الشخص والصلاحية والنطاق؛ عضويات أو استثناءات شركة تانية تظهر.

## English

1. Top bar **Permissions** (الصلاحيات) → the membership list (**Membership**). None: "No memberships found."
2. Choose a person → **Role** with its localized name (for example **Branch Manager**), **Membership window**, **Role
   defaults**, **Personal overrides** and **Ended overrides**.
3. **New override:** choose a **Permission** (tenant permissions only), **Decision** (**Allow** / **Deny**), **Scope**
   (**Company** / **Business** / **Branch**) and its identifier, a **Reason** (required) and an optional **Expiry (UTC,
   optional)** in the future → **Save override** → "Override saved." and it shows **Active**.
4. **Changing the decision:** save another decision for the same person, permission and scope → the old one moves to
   **Ended overrides**; only the new one is current.
5. **Revoke:** **Revoke override** with a reason → "Override revoked." and it moves to the ended list. Revoking an
   ended one → "This override has already ended".
6. **A permission you do not hold** → "You do not currently hold this permission over the target scope".
7. **Yourself:** any membership that is yours → "You cannot edit permissions on your own membership".
8. **An owner:** a Deny on any membership of a person who is an owner — even their second, lower one → "Owner
   permissions are protected from this change".
9. Without the edit permission the screen is read-only: "You cannot edit this membership’s permissions."
10. A clash with a simultaneous change → "The change conflicted with another transaction and was not saved. Please
    retry." (never a server error).
11. Every save and revoke is audited (who, what, before/after, reason).

**Must NOT happen:** granting a permission you do not hold; editing your own permissions; an owner locked out of
permission management; two current decisions for one person, permission and scope; another company's memberships or
overrides visible.

## For an agent

- Admin at `http://localhost:3001/permissions`; find controls by visible text (Arabic or English above).
- API: `GET /v1/permissions/memberships` and `/v1/permissions/memberships/{membershipId}` with `x-company-id`;
  `POST /v1/permissions/memberships/{membershipId}/overrides` and
  `POST /v1/permissions/memberships/{membershipId}/overrides/{overrideId}/revoke`; errors are 403/409 with the
  messages above.
- Role defaults are read-only here; default bundles per role arrive with PR 7a.
