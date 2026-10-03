# 11 · The email channel (built, sending off) — قناة الإيميل (جاهزة، والإرسال مقفول)

**Status / الحالة:** shipped in #75 (PR 14, ADR-0014). **Live email is deliberately disabled**: it opens only after
bounce/complaint intake, durable suppression and the 30-day scrub ship. There is nothing to click yet; this journey
checks that the channel is safely off.

**Before you start / قبل ما تبدأ:** [00 Local setup](00-local-setup.md) steps 1–3 (build the API and worker).

## العربي

1. شغّل الـ API والـ worker بإعدادات الإيميل فاضية (`RESEND_API_KEY` وباقي `EMAIL_*` فاضيين) ← الاتنين يقوموا عادي،
   و`/ready` يرجّع **200**.
2. في الـ logs لازم تلاقي سطر إن قناة الإيميل مقفولة: `"channel":"email","enabled":false,"reason":"EMAIL_FEEDBACK_NOT_IMPLEMENTED"`.
3. حتى لو حطيت مفتاح Resend وكل إعدادات `EMAIL_*` ← **برضه مفيش إيميل بيتبعت** لحد ما الجزء الناقص يتبني (ده مقصود).
4. اختبار جاهز يعمل الخطوات دي لوحده: `node scripts/notifications/email-production-smoke.mjs` ← لازم يطبع
   `health=200 ready=200 email=disabled` للاتنين.
5. **سجل الإرسال** (للمالك والمدير): أي محاولة إيميل فشلت أو اتمنعت بتبان فيه بحالتها، من غير عنوان الإيميل ولا نص الرسالة.

**ممنوع يحصل:** إيميل حقيقي يتبعت دلوقتي؛ السيرفر يقع أو `/ready` يفشل بسبب إعدادات الإيميل؛ عنوان إيميل أو نص رسالة أو
مفتاح Resend يظهر في أي log أو رد؛ نفس الرسالة تتبعت مرتين.

## English

1. Start the API and the worker with every email setting empty (`RESEND_API_KEY` and the other `EMAIL_*`) → both
   start normally and `/ready` answers **200**.
2. The logs contain the disabled-channel line: `"channel":"email","enabled":false,"reason":"EMAIL_FEEDBACK_NOT_IMPLEMENTED"`.
3. Even with a Resend key and every `EMAIL_*` setting filled → **still no email is sent** until the missing part ships
   (by design).
4. A ready-made check runs these steps: `node scripts/notifications/email-production-smoke.mjs` → it must print
   `health=200 ready=200 email=disabled` for both apps.
5. **Delivery log** (owner and manager): a failed or suppressed email attempt appears with its status, never with the
   address or the message body.

**Must NOT happen:** a real email sent now; a crash or failing `/ready` because of email settings; an address, body
or Resend key in any log or response; the same message sent twice.

## For an agent

- No browser step. Run the smoke script after building api and worker; assert exit code 0 and both
  `email=disabled` lines.
- Never put a real API key or a real recipient address in a test.
