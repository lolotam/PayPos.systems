# apps/business — «PosPay Business»

الغلاف الأصلي (Capacitor) لتطبيق «PosPay Business»: iOS و Android، وبيغلّف بناء `apps/pos`
نفسه (ADR-0055). مفيش كود شاشات هنا — الشاشات في `apps/pos` عشان الـ PWA والتطبيق ما يختلفوش
(`CLAUDE.md` §7). اللي هنا: إعداد Capacitor، مشروعا Xcode و Gradle، وأوامر المزامنة.

## نسختين البناء (flavours)

نسختين البناء من نفس المصدر، كل واحدة تنصب جنب بعض على نفس الموبايل، ولكل واحدة id بتاعها
و API بتاعها (ADR-0055 قرار 4):

| نسخة البناء | `appId` | الـ API | `server.hostname` (أندرويد بس) |
| --- | --- | --- | --- |
| `staging` (الافتراضي) | `systems.pospay.business.staging` | `api.staging.pospay.systems` | `pos.staging.pospay.systems` |
| `production` | `systems.pospay.business` | `api.pospay.systems` | `pos.pospay.systems` |

الـ `appId` ما يتغيرش بعد أول رفع للمتجر. والـ `server.hostname` ده لأندرويد بس: iOS بيقرا
`server.hostname` كمان، بس لازم يفضل على `capacitor://localhost` عشان الـ secure context
(ADR-0055 قرار 3). وتغيير الـ hostname أو الـ scheme بعد أول إصدار = origin جديد، والـ
IndexedDB (ربط الجهاز وطابور المزامنة) بيضيع.

## المزامنة

البناء الأول لازم يكون نسخة التطبيق الأصلي، لأن `webDir` بيشاور على `apps/pos/dist-native`:

```bash
pnpm --filter @pospay/pos build:native
```

بعدين مزامنة الأصول داخل المشروع الأصلي، وهي الطريقة المسموحة الوحيدة:

```bash
pnpm --filter @pospay/business sync:staging
pnpm --filter @pospay/business sync:production
```

كل أمر بيشغّل `cap sync` للمنصتين واحدة واحدة — أندرويد الأول وبعدين iOS — مع `FLAVOUR`
المناسب. و`cap sync` لوحده مش مسموح: هيسيب أندرويد من غير الـ hostname بتاعه. مفيش أمر
`build` هنا عن قصد: بناء لينكس ما يحتاجش Xcode ولا Android SDK.

## أسرار الـ CI

الملف ده فيه **أسماء** المتغيرات بس. القيم كلها أسرار في environments بتاعت GitHub Actions
(ADR-0055 قرار 5) — `mobile-staging` و `mobile-production`، ومفيش مفتاح أو ملف توقيع
في المستودع (`CLAUDE.md` §8).

الأسماء دي **مقترحة**: sub-PR اللي بيكتب stage C (ADR-0055 قرار 6) هو اللي بيثبّتها.

| الاسم | القيمة |
| --- | --- |
| `IOS_APP_STORE_CONNECT_API_KEY_ID` | |
| `IOS_APP_STORE_CONNECT_API_KEY_ISSUER_ID` | |
| `IOS_APP_STORE_CONNECT_API_KEY_P8` | |
| `IOS_DISTRIBUTION_CERTIFICATE_P12_BASE64` | |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | |
| `IOS_PROVISIONING_PROFILE_STAGING` | |
| `IOS_PROVISIONING_PROFILE_PRODUCTION` | |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | |
| `ANDROID_UPLOAD_KEY_ALIAS` | |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_STAGING` | |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PRODUCTION` | |
