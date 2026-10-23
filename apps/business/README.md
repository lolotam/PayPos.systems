# apps/business — «PosPay Business»

الغلاف الأصلي (Capacitor) لتطبيق «PosPay Business»: iOS و Android، وبيغلّف بناء `apps/pos`
نفسه (ADR-0055). مفيش كود شاشات هنا — الشاشات في `apps/pos` عشان الـ PWA والتطبيق ما يختلفوش
(`CLAUDE.md` §7). اللي هنا: إعداد Capacitor، مشروعا Xcode و Gradle، وأوامر المزامنة.

## الطعمان (flavours)

التطبيقان نسخة واحدة تنصب جنب بعض على نفس الموبايل، ولكل واحد id بتاعه و API بتاعه
(ADR-0055 قرار 4):

| الطعم | `appId` | الـ API | `server.hostname` |
| --- | --- | --- | --- |
| `staging` (الافتراضي) | `systems.pospay.business.staging` | `api.staging.pospay.systems` | `pos.staging.pospay.systems` |
| `production` | `systems.pospay.business` | `api.pospay.systems` | `pos.pospay.systems` |

الـ `appId` والـ `server.hostname` ما يتغيروش بعد أول رفع للمتجر: تغييرهم = origin جديد،
والـ IndexedDB (ربط الجهاز وطابور المزامنة) بيضيع.

## المزامنة

البناء الأول لازم يكون نسخة التطبيق الأصلي، لأن `webDir` بيشاور على `apps/pos/dist-native`:

```bash
pnpm --filter @pospay/pos build:native
```

بعدين مزامنة الأصول داخل المشروع الأصلي:

```bash
pnpm --filter @pospay/business sync:staging
pnpm --filter @pospay/business sync:production
```

كل أمر بيشغّل `cap sync` مع `FLAVOUR` المناسب. مفيش أمر `build` هنا عن قصد: بناء لينكس
ما يحتاجش Xcode ولا Android SDK.

## أسرار الـ CI

الملف ده فيه **أسماء** المتغيرات بس. القيم كلها أسرار في environments بتاعت GitHub Actions
(ADR-0055 قرار 5) — `mobile-staging` و `mobile-production`، ومفيش مفتاح أو ملف توقيع
في المستودع (`CLAUDE.md` §8):

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
