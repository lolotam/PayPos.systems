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
- لازم `BETTER_AUTH_TRUSTED_ORIGINS` و `CORS_ORIGINS` يتحدثوا مع أي subdomain جديد — ونسيانه بيدي رفض غامض في الـ requests
- الانتقال لـ Gulf region بعدين (المخطط في `06` §5.15) هيحتاج تحديث كل الـ A records — عملية بسيطة بس لازم تتعمل مرة واحدة

### مخاطر مفتوحة

- **اسم "PosPay":** كلمة "Pay" بتوصّل إن المنصة مزوّد مدفوعات، بينما المعمارية (`06` §5.9.1) اختارت **BYO model** تحديدًا عشان متمسكش فلوس التجار وبالتالي ما تحتاجش ترخيص **EPSP** من بنك الكويت المركزي. الاسم محتاج مراجعة قانونية قبل ما يثبت في الفواتير والـ WABA.
- **مكان الـ staging:** لسه مفتوح (السؤال 6 في قائمة `TODO(spec)`) — الـ ADR ده بيفترض بيئة staging موجودة بس مش بيحدد على أنهي server.
