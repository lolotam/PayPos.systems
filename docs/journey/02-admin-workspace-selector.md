# 02 · Choosing the company, business and branch — اختيار الشركة والنشاط والفرع

**Status / الحالة:** shipped in #52 (the API) and #53 (the screen). Local only for now.

**Before you start / قبل ما تبدأ:** signed in as in [01](01-admin-sign-in-and-totp.md). For the full journey the
user needs memberships in two companies, a business with two branches, and one inactive branch.

## العربي

1. بعد الدخول بص في أول القائمة الجانبية (تحت اللوجو): فيه 3 قوائم **الشركة** و **النشاط** و **الفرع**.
   - لو المستخدم عضو في شركة واحدة بس: هتتختار لوحدها.
   - لو مش عضو في أي شركة: هتشوف **لا توجد شركة**.
2. اختار شركة ← قائمة النشاط تتملي بأنشطة الشركة دي بس ← اختار نشاط ← قائمة الفرع تتملي بفروعه بس.
3. الفرع غير النشط بيظهر وجنبه كلمة **غير نشط**، وتقدر تختاره.
4. **مساحة العمل** في النص تعرض أسامي الشركة والنشاط والفرع اللي اخترتهم.
5. غيّر الشركة ← اختيار النشاط والفرع بتاع الشركة القديمة يتشال؛ لو فيه نشاط أو فرع واحد بس بيتختار لوحده، غير كده تختار تاني.
6. اقفل الصفحة وافتحها تاني ← نفس الاختيار يفضل محفوظ.
7. مستخدم عضويته على فرع واحد بس: يشوف الفرع ده ونشاطه بس، مش باقي الفروع.

**ممنوع يحصل:** ظهور شركة أو فرع المستخدم مش عضو فيه؛ ظهور بيانات الشركة اللي قبلها بعد التغيير.

## English

1. After signing in, the top of the dark sidebar (under the logo) shows three lists: **Company** (الشركة), **Business** (النشاط), **Branch** (الفرع).
   One available company → chosen automatically; none → "No company yet" (لا توجد شركة).
2. Choose a company → Business lists only that company's businesses → choose one → Branch lists only its branches.
3. An inactive branch is shown with **Inactive** (غير نشط) and can still be chosen.
4. The **Workspace** card shows the chosen company, business and branch names.
5. Change the company → the previous company's business and branch are discarded; a sole business or branch is
   selected automatically, otherwise choose again.
6. Reload the page → the same choice is still selected.
7. A user whose membership is one branch sees only that branch and its business.

**Must NOT happen:** a company or branch the user is not a member of; the previous company's data after switching.

## For an agent

- Lists are comboboxes labelled **Company / Business / Branch** (الشركة / النشاط / الفرع).
- API check: requests through the generated admin API client carry the chosen `x-company-id`; auth-client calls do not.
