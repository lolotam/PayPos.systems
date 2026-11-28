# ADR 0001 — الدومين وتقسيم الـ Subdomains

- **الحالة:** مقبول
- **التاريخ:** 2026-09-20
- **يخص:** `06_Tech_Stack_Architecture_EN.md` §5.15 · `09_Dashboards_Roles_Permissions_AR.md` §1

> لو الرقم `0001` متاخد في `docs/adr/` عندك، غيّره للرقم اللي بعده.

---

## السياق

المنتج اتسمى **PosPay**، والدومين المحجوز هو **`pospay.systems`**.

المنصة فيها خمس تطبيقات منفصلة (`admin` · `pos` · `menu` · `api` · `worker`)، وكل واحد ليه جمهور مختلف تمامًا ومستوى حساسية مختلف. لازم نقرر إزاي نوزّعهم على الدومين قبل ما نكتب أي إعدادات، لأن العنوان بيدخل في:

- الـ DNS records والـ TLS certificates
- الـ routing في Traefik / Dokploy
- نطاق الـ cookies والـ CORS والـ `BETTER_AUTH_TRUSTED_ORIGINS`
- عناوين الـ webhooks المسجّلة عند Meta وMyFatoorah وTap
- قالب الفاتورة والاسم الموثّق في الـ WABA

تغيير القرار ده بعد ما يتبني بيلمس عشرات الحتت، وبيكسر تكاملات خارجية مسجّلة عند طرف تالت.

### ملاحظة على الامتداد

`.system` (بالمفرد) **مش امتداد موجود** في جذر الـ DNS — اتأكدنا من القائمة الرسمية لـ IANA. الامتداد الصح هو `.systems` (بالجمع)، وهو gTLD عادي بيشتغل طبيعي مع Let's Encrypt والمتصفحات وكل الخدمات.

---

## القرار

### 1. تطبيق واحد = subdomain واحد

| Subdomain | التطبيق | الجمهور |
|---|---|---|
| `app.pospay.systems` | `apps/admin` | صاحب البيزنس وإدارته |
| `platform.pospay.systems` | module `platform` | السوبر أدمن (مالك المنصة) |
| `pos.pospay.systems` | `apps/pos` | الكاشير على أجهزة الفروع |
| `menu.pospay.systems` | `apps/menu` | العميل النهائي |
| `api.pospay.systems` | `apps/api` | التطبيقات (مش بشر) |
| `cdn.pospay.systems` | Cloudflare R2 | ملفات عامة |
| `pospay.systems` · `www` | صفحة تعريفية | زوار |

الـ `worker` **مالوش subdomain** — مش بيستقبل حاجة من بره.

### 2. لوحة المنصة اسمها `platform.` مش `admin.`

ملف `09` كان مقترح `admin.` أو `platform.`. اخترنا **`platform.`** لأن `apps/admin` في الكود هو أصلاً لوحة **صاحب البيزنس** — استخدام `admin.` للوحة المنصة بيخلق لبس دائم بين الاتنين، واللبس ده في نظام multi-tenant بيتحول لتسريب بيانات.

### 3. الجلسات: cookie على مستوى الدومين الأب

`COOKIE_DOMAIN=.pospay.systems` عشان الجلسة الواحدة تشتغل بين `app.` و `api.`.

الـ subdomains بتاعت نفس الدومين تُعتبر **same-site**، فالكوكي بـ `SameSite=Lax` + `Secure` + `HttpOnly` بيشتغل بينهم من غير ما نضطر نفتح `SameSite=None`.

**استثناء مقصود:** جلسة `platform.` تفضل منفصلة تمامًا عن جلسات العملاء، تنفيذًا لقاعدة الفصل في `09` §1.

### 4. الشهادات: واحدة لكل host، مش wildcard

Traefik بياخد شهادة مستقلة لكل subdomain عن طريق **HTTP-01**.

مش هنستخدم wildcard (`*.pospay.systems`) دلوقتي، لأنه بيحتاج **DNS-01** ومعاه API token للـ DNS provider — تعقيد من غير فايدة حالية.

**هنحتاجه** بس لو قررنا ندي كل تاجر subdomain خاص (`<merchant>.menu.pospay.systems`) — وساعتها يتفتح ADR جديد.

### 5. Cloudflare: `api.` يفضل DNS-only

الـ realtime عندنا **SSE** (اتصال HTTP مفتوح طويل). الـ proxy بتاع Cloudflare بيقفل الاتصالات دي، فالشاشات هتفصل بشكل متقطع وغير مفهوم.

القرار: `api.pospay.systems` يفضل **رمادي (DNS only) بشكل دائم**. باقي الـ subdomains تفضل رمادي لحد ما كل حاجة تستقر، وبعدين تتحول لبرتقالي مع SSL mode = **Full (strict)**.

### 6. Staging تحت `staging.pospay.systems`

`app.staging` · `api.staging` · `pos.staging`، وبـ `COOKIE_DOMAIN=.staging.pospay.systems` عشان جلسات الاختبار ما تختلطش بجلسات الإنتاج أبدًا.

---

## النتائج

### إيجابية

- فصل كامل بين لوحة المنصة ولوحات العملاء على مستوى الـ origin — أقوى حاجز ممكن في المتصفح
- كل تطبيق بيتـ deploy ويتـ rollback لوحده من غير ما يلمس التاني
- إعدادات الـ cache والـ CDN والحماية تتظبط لكل جمهور على حدة
- الـ POS عمره ما هيتأثر بأي إعداد اتعمل للواجهة العامة

### سلبية / تكلفة

- عدد أكبر من الـ DNS records والشهادات (Traefik بيديرها أوتوماتيك، فالتكلفة وقت إعداد أولي بس)
- لازم تحديث `AUTH_TRUSTED_ORIGINS` مع أي origin جديد يحتاج ثقة Better Auth؛ وعند ضبط `API_CORS_ORIGINS` (ملحق `#669` أدناه) فهي تستبدل القائمة الافتراضية بالكامل فلازم تشمل كل الأصول التي تحتاج CORS من الـ API (أصول الويب مثل admin وPOS بالإضافة لأي أصل يحتاج CORS فقط مثل `capacitor://localhost`) — ونسيانهما بيدي رفض غامض في الـ requests
- الانتقال لـ Gulf region بعدين (المخطط في `06` §5.15) هيحتاج تحديث كل الـ A records — عملية بسيطة بس لازم تتعمل مرة واحدة

### مخاطر مفتوحة

- **اسم "PosPay":** كلمة "Pay" بتوصّل إن المنصة مزوّد مدفوعات، بينما المعمارية (`06` §5.9.1) اختارت **BYO model** تحديدًا عشان متمسكش فلوس التجار وبالتالي ما تحتاجش ترخيص **EPSP** من بنك الكويت المركزي. الاسم محتاج مراجعة قانونية قبل ما يثبت في الفواتير والـ WABA. **اتحسم 2026-09-23:** المحامي شايف إن مفيش مانع، والاسم PosPay فاضل زي ما هو (PRD D-02).
- **مكان الـ staging:** **اتحسم 2026-09-23 (PRD D-11):** الـ staging على السيرفر الحالي مؤقتًا جنب الـ production، والاتنين هيتنقلوا على سيرفر جديد لما يتشترى.

---

## ملحق: فصل `API_CORS_ORIGINS` عن `AUTH_TRUSTED_ORIGINS` (#669)

- يظل `AUTH_TRUSTED_ORIGINS` هو المصدر الافتراضي للاتنين إذا كان `API_CORS_ORIGINS` فارغاً أو غير مضبوط، حتى لا ينحرفا عن بعض في الإعداد البسيط.
- عند الحاجة إلى منح origin معيّن صلاحية CORS من Fastify دون إضافته إلى `trustedOrigins` أو ثقة Better Auth (مثل `capacitor://localhost` لتطبيق iOS على الإنتاج)، تُضبط قائمة `API_CORS_ORIGINS` الاختيارية؛ ولأنها تستبدل القائمة الافتراضية بالكامل عند ضبطها، يجب أن تتضمن كل الأصول التي تحتاج CORS من الـ API (بما فيها أصول الويب المعتمدة مثل admin وPOS إلى جانب الأصل الإضافي) بأصول صريحة فقط (`http(s)` أو `capacitor://localhost` بلا wildcards).
- يتطلب تفعيل الفصل في بيئات النشر تمرير متغير `API_CORS_ORIGINS` لحاوية `api` في ملفات Compose الخاصة بالنشر قبل الاعتماد على قائمتين منفصلتين.
- لا يدخل `RATING_PAGE_ORIGIN` في أيٍّ من `AUTH_TRUSTED_ORIGINS` أو `API_CORS_ORIGINS` (ADR-0058).
