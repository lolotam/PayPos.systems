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

على iOS النسخة بتاخدها `xcodebuild` من سطر `-xcconfig`: `-xcconfig ios/staging.xcconfig` أو
`-xcconfig ios/production.xcconfig` (سير العمل بتاع M-1b بيبعته). والبناء من غير السطر ده
بيطلع نسخة `staging`، فالرفع على production من غيره بيت رفض من الـ bundle id بتاعه بدل ما
ينزل التطبيق الغلط.

## المزامنة

البناء الأول لازم يكون نسخة التطبيق الأصلي، لأن `webDir` بيشاور على `apps/pos/dist-native`،
والـ API origin بيتخبّط جوّه الحزمة، فكل نسخة ليها بناء خاص بيها:

```bash
VITE_API_URL=https://api.staging.pospay.systems FLAVOUR=staging pnpm --filter @pospay/pos build:native
VITE_API_URL=https://api.pospay.systems FLAVOUR=production pnpm --filter @pospay/pos build:native
```

بعدين مزامنة الأصول داخل المشروع الأصلي، وهي الطريقة المسموحة الوحيدة:

```bash
pnpm --filter @pospay/business sync:staging
pnpm --filter @pospay/business sync:production
```

كل أمر بيشغّل `cap sync` للمنصتين واحدة واحدة — أندرويد الأول وبعدين iOS — مع `FLAVOUR`
المناسب. و`cap sync` لوحده مش مسموح: هيسيب أندرويد من غير الـ hostname بتاعه. مفيش أمر
`build` هنا عن قصد: بناء لينكس ما يحتاجش Xcode ولا Android SDK.

الـ `dist-native` وأصول أندرويد بيحملوا نسخة واحدة في كل مرة، فزامن النسخة اللي هتبني
بعدها، وبعدين ابني نفس نسخة Gradle. وأمر `turbo` بيبني نسخة التطبيق الأصلي ويزامن في خطوة
واحدة، بس قائمة `env` فيه بتعمل hash للمتغيرات ومش بتحطّهم، فلازم `VITE_API_URL` و `FLAVOUR`
يبقوا في نفس السطر:

```bash
VITE_API_URL=https://api.staging.pospay.systems FLAVOUR=staging pnpm turbo run sync:staging --filter=@pospay/business
VITE_API_URL=https://api.pospay.systems FLAVOUR=production pnpm turbo run sync:production --filter=@pospay/business
```

## أسرار الـ CI

الملف ده فيه **أسماء** المتغيرات بس. القيم كلها أسرار في environments بتاعت GitHub Actions
(ADR-0055 قرار 5) — `mobile-staging` و `mobile-production`، ومفيش مفتاح أو ملف توقيع
في المستودع (`CLAUDE.md` §8).

أي مفتاح أو ملف توقيع محتاجه على جهاز المبرمج (مثل ملف الـ service account بتاع Play، وGoogle
بيسمّيه باسم المشروع) بيتحفظ في `apps/business/.secrets/` بس، والمجلد ده git مش بيتابعه، لأن مفيش
ignore pattern يقدر يخمّن اسم الملف ده.

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

## الأيقونات وشاشة الفتح (M-1e)

مصادر التصميم في `assets/brand/` (SVG): نفس حرف P والنقطة بتوع أيقونة الويب (`apps/pos/public/icon.svg`)، ودايرة كحلي
فيها «B» في الركن (APP-Q21)، وشريط بنفسجي مايل فيه «تجربة» على أيقونة نسخة التجربة (APP-Q22). صور أندرويد
(`android/app/src/main/res/mipmap-*` و`drawable*/splash.png`، وأيقونات التجربة في `android/app/src/staging/res/`)
وصور iOS (`AppIcon` و`AppIconStaging` و`Splash` جوّه `Assets.xcassets`) متولّدة من المصادر دي بـ Playwright، ومتسجّلة
كملفات متولّدة: أي تعديل في الشكل يبدأ من الـ SVG وبعدين الصور كلها تتولّد تاني. أندرويد بياخد أيقونة التجربة لوحده من
فولدر الـ flavour، وiOS بيختارها من `ASSETCATALOG_COMPILER_APPICON_NAME` في `ios/staging.xcconfig`. شاشة الفتح خلفيتها
برتقالي وفيها الحرف P وتحته «PosPay Business» (APP-Q11، APP-Q25).
