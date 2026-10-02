# 05 · A customer replies STOP on WhatsApp — العميل يرد "إيقاف"

**Status / الحالة:** shipped in #60 (PR 5). There is no screen: this journey is checked through the webhook and the
database. A real test needs the Meta webhook subscription and the WhatsApp secrets in Dokploy (not set yet).

**Before you start / قبل ما تبدأ:** the API running with `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
`WHATSAPP_WABA_ID`, `WHATSAPP_PHONE_NUMBER_ID`, the notification hash keys and `TRUSTED_PROXY_CIDRS` set (local:
test values). Without them the webhook answers **503** — that is the expected safe state.

## العربي

1. **من غير الإعدادات:** `GET /v1/webhooks/whatsapp` ← **503**. ده الصح: الـ API بيرفض لحد ما يتظبط.
2. **بالإعدادات:** Meta بتعمل التحقق الأول بـ `GET` ومعاه الـ verify token ← الـ API يرد بالـ challenge.
3. عميل يرد على رسالة بكلمة واحدة: **STOP** أو **UNSUBSCRIBE** أو **إيقاف** أو **ايقاف** أو **توقف**
   (أو يدوس زرار الإيقاف المعتمد) ← الـ API يرد 200، ورقمه يتسجل في قائمة المنع (كبصمة بس، من غير الرقم).
4. عميل يرد **إلغاء** أو **CANCEL** أو جملة فيها كلمة stop ← **ما يتمنعش**.
5. أي رسالة لنفس الرقم بعد كده ← تتسجل `SUPPRESSED` وما تتبعتش.
6. نفس الرسالة توصل مرتين من Meta ← المنع يتسجل مرة واحدة بس.
7. بعد 30 يوم محتوى الرسائل الواردة يتمسح، وقائمة المنع تفضل.

**ممنوع يحصل:** رسالة توصل لرقم قال "إيقاف"؛ الرقم أو معرّف رسالة واتساب يتخزن أو يظهر في الـ logs.

## English

1. **Without settings:** `GET /v1/webhooks/whatsapp` → **503**, the safe state.
2. **With settings:** Meta's `GET` verification with the verify token → the API echoes the challenge.
3. A reply of exactly **STOP**, **UNSUBSCRIBE**, **إيقاف**, **ايقاف** or **توقف** (or the approved STOP button)
   → HTTP 200 and the phone is suppressed (stored as an HMAC only).
4. **إلغاء**, **CANCEL** or a sentence containing "stop" → **not** suppressed.
5. Any later message to that phone → recorded `SUPPRESSED`, never sent.
6. The same Meta delivery twice → one suppression, one audit row.
7. After 30 days the inbound payload JSON is cleared; the suppression stays.

**Must NOT happen:** a message reaching a phone that replied STOP; the phone or the original WhatsApp message id
stored or logged.

## For an agent

- Requests must be signed: `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body with the app secret>`.
- Check in the database (owner role): `platform_whatsapp_suppressions` has one row per stopped phone hash and no
  phone column; `platform_whatsapp_inbox` holds a message-id digest, never the original id.
