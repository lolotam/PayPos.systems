# 05 · A customer replies STOP on WhatsApp — العميل يرد "إيقاف"

**Status / الحالة:** shipped in #60 (PR 5). There is no screen: this journey is checked through the webhook and the
database. A real test needs the Meta webhook subscription and the WhatsApp secrets in Dokploy (not set yet).

**Before you start / قبل ما تبدأ:**
- **Disabled state (503):** leave `PLATFORM_NOTIFICATIONS_DATABASE_URL` empty.
- **Enabled intake:** `POSTGRES_NOTIFICATIONS_PASSWORD` (applied by migrations) and
  `PLATFORM_NOTIFICATIONS_DATABASE_URL` as `pospay_notifications`, plus `NOTIFICATION_PHONE_HASH_KEY`,
  `NOTIFICATION_PHONE_HASH_KEY_ID`, `NOTIFICATION_MESSAGE_ID_HASH_KEY`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WABA_ID`, `WHATSAPP_PHONE_NUMBER_ID` and `TRUSTED_PROXY_CIDRS`
  (local: test values). The worker gets the same intake URL for maintenance. Button tests also need
  `WHATSAPP_STOP_BUTTON_ID`.

## العربي

1. **من غير الإعدادات** (`PLATFORM_NOTIFICATIONS_DATABASE_URL` فاضي): `GET /v1/webhooks/whatsapp` ← **503**. ده الصح.
2. **بالإعدادات:** Meta بتعمل التحقق الأول بـ `GET` ومعاه الـ verify token ← الـ API يرد بالـ challenge.
3. عميل يرد على رسالة بكلمة واحدة: **STOP** أو **UNSUBSCRIBE** أو **إيقاف** أو **ايقاف** أو **توقف**
   (أو يدوس زرار الإيقاف المعتمد) ← الـ API يرد 200، ورقمه يتسجل في قائمة المنع (كبصمة بس، من غير الرقم).
4. عميل يرد **إلغاء** أو **CANCEL** أو جملة فيها كلمة stop ← **ما يتمنعش**.
5. أي طلب إرسال واتساب صالح بعد كده لنفس الرقم (مش منتهي، بلغة مدعومة، ووجهة سليمة) ← يتسجل `SUPPRESSED` وما يتبعتش؛
   لو الطلب فيه مشكلة قبل كده بيتسجل `FAILED` أو `EXPIRED` وبرضه ما يتبعتش. التحقق دلوقتي باختبار تجريبي؛ الإرسال
   الحقيقي لسه مقفول لحد تنفيذ PR 6.
6. نفس الرسالة توصل مرتين من Meta ← المنع يتسجل مرة واحدة بس.
7. صيانة الـ worker كل ساعة بتمسح محتوى الرسائل الواردة اللي عدّى عليها 30 يوم على الأقل؛ قائمة المنع والبصمات
   والتدقيق بتفضل.

**ممنوع يحصل:** رسالة توصل لرقم قال "إيقاف"؛ الرقم أو معرّف رسالة واتساب يتخزن أو يظهر في الـ logs.

## English

1. **Without settings** (`PLATFORM_NOTIFICATIONS_DATABASE_URL` empty): `GET /v1/webhooks/whatsapp` → **503**, the safe state.
2. **With settings:** Meta's `GET` verification with the verify token → the API echoes the challenge.
3. A reply of exactly **STOP**, **UNSUBSCRIBE**, **إيقاف**, **ايقاف** or **توقف** (or the approved STOP button)
   → HTTP 200 and the phone is suppressed (stored as an HMAC only).
4. **إلغاء**, **CANCEL** or a sentence containing "stop" → **not** suppressed.
5. A later unexpired request with a supported locale and a valid destination for that phone → recorded `SUPPRESSED`;
   one that fails earlier validation is recorded `FAILED` or `EXPIRED`. None is sent. Checked today in a test
   fixture; live sending stays closed until PR 6.
6. The same Meta delivery twice → one suppression, one audit row.
7. The worker's hourly maintenance clears scrubbed inbound JSON at least 30 days old; suppressions, message
   digests and audit stay.

**Must NOT happen:** a message reaching a phone that replied STOP; the phone or the original WhatsApp message id
stored or logged.

## For an agent

- `POST /v1/webhooks/whatsapp` with `Content-Type: application/json` and
  `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body with the app secret>`.
- The `GET` handshake uses `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge` (no signature).
- Check in the database (owner role): `platform_whatsapp_suppressions` has one row per stopped phone hash and no
  phone column; `platform_whatsapp_inbox` holds a message-id digest, never the original id.
