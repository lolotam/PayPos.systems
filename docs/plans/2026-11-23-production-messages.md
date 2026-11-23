# Production messages on day one — what exists, what is missing (2026-11-23)

Read against `origin/main@dc5b78786`. Owner answer (Waleed, 2026-11-23): «اشعارات جوة التطبيق ونضيف الايميل resend
ونضيف الواتس اب الحساب جاهز ولكن بدون قوالب». Nothing was sent or configured; code reading only.

## Summary

| Channel | State in the code today | Works on day one? |
|---|---|---|
| In-app bell | Built and on in production | **Yes**, with no extra setup |
| Staff web push | Built; on when the three `VAPID_*` keys are set | **Yes**, after Waleed generates the keys |
| Email (Resend) | Adapter written, **switched off by a constant**; the prerequisite the owner set on 2026-10-03 is not built | **No**, until PR-C1 and PR-C2 merge |
| WhatsApp — staff OTP | Built, gated on an approved AUTHENTICATION template | **No**, until Meta approves the template |
| WhatsApp — messages to customers and the team | **Closed in production by code**; no template names can be supplied | **No**, needs templates and a code slice |

## 1. In-app and push

- The production worker always builds the in-app consumer: `apps/worker/src/main.ts:130-138`
  (`createInAppNotificationModule`). Recipients with channel `IN_APP` are stored, `PUSH` ones are queued:
  `apps/worker/src/modules/notifications/events/handlers/on-notification-request.handler.ts:97-102`.
- Push needs `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (api and worker) and `VAPID_PRIVATE_KEY` (worker only), generated
  once with `pnpm push:generate-vapid` (`deploy/staging.env.example:85-89`). Production gets its own pair.

## 2. Email

**Exists**

- A Resend adapter: `packages/notifications/src/adapters/resend.channel.ts:21` (`ResendChannel`), posting to
  `https://api.resend.com/emails` (line 109). It reads `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`,
  `RESEND_API_KEY`, `EMAIL_ADMIN_ORIGIN` (lines 32-36).
- Operational email rendering (`packages/notifications/src/templates/email-operational.ts`), the email identity hash
  (`email-identity.ts`) and the worker email module (`apps/worker/src/modules/notifications/email.module.ts`). Which
  producers emit an email recipient today was not traced in this pass; document-expiry notices (Phase 1 row 15,
  `apps/worker/src/modules/staff/domain/document-expiry-notice.ts`) are the planned first user.
- The provider decision: ADR-0014 (Accepted) — Resend.

**Why nothing is sent**

- The capability is a constant, not a setting: `packages/notifications/src/email-configuration.ts:10-12` returns
  `enabled: false, reason: 'EMAIL_FEEDBACK_NOT_IMPLEMENTED'` whatever the environment holds.
- The worker never constructs `ResendChannel`: `createEmailChannelAdapter(options.testing?.channel)`
  (`email.module.ts:44`) receives a channel only in tests, so every send is refused with `CONFIG_INVALID`
  (`persistence/email-channel.adapter.ts:9`), and every authorization is recorded as `CONFIG_INVALID`
  (`email.module.ts:90-92`).
- The admin origin is a literal `https://app.pospay.systems` (`email.module.ts:67`, `email-channel.adapter.ts:15`).
- The reason is a recorded owner decision: hard-bounce and complaint suppression must exist **before live sending**
  (ADR-0014 §3, owner 2026-10-03). That needs the Resend webhook intake (signed, deduplicated), the feedback inbox,
  reconciliation to the attempt, and suppression. None of it is in the repo.

**Missing**

- Code: the feedback intake and suppression (PR-C1, a migration and a public webhook — Heavy), then the activation
  (PR-C2: build `ResendChannel` in the worker, read the configuration, take the origin from the environment).
- Compose keys: none of the email keys is passed to any container today. `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`,
  `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`, `EMAIL_ADMIN_ORIGIN`, `NOTIFICATION_EMAIL_HASH_KEY`,
  `NOTIFICATION_EMAIL_HASH_KEY_ID` appear in `.env.example` but not in `deploy/docker-compose.staging-shared.yml` or
  `deploy/staging.env.example`. A webhook signing secret key will be new.
- Waleed: a Resend account, the sending domain verified (SPF, DKIM, DMARC records in Cloudflare), an API key, the
  webhook endpoint registered in Resend, and the sender name and address (ADR-0014 §3 lists them as activation
  prerequisites).

**Question for Waleed (technical).** The fastest route to "email on day one" would be to send without bounce
handling. That reverses his own 2026-10-03 decision. Options: (1) *recommended* — keep the decision; email goes live
when PR-C1 and PR-C2 merge, possibly after go-live; (2) waive it for the pilot and ship PR-C2 alone, accepting that
bounces and complaints are visible only in the Resend dashboard.

## 3. WhatsApp

**Staff OTP (sign-in code to an employee's phone)** — built, closed until every one of these is true
(`packages/auth/src/staff-otp/configuration.ts:79-92`): `STAFF_OTP_ENABLED=true`, `NOTIFICATIONS_MODE=live`,
`WHATSAPP_STOP_SUBSCRIPTION_CONFIRMED=true`, `STAFF_OTP_TEMPLATES_APPROVED=true`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WABA_ID`, `WHATSAPP_PHONE_NUMBER_ID`,
`PLATFORM_NOTIFICATIONS_DATABASE_URL` (with `POSTGRES_NOTIFICATIONS_PASSWORD` in `migrate`), the two phone hash keys,
the derivation and verification key pairs, and the worker's `WHATSAPP_ACCESS_TOKEN`. The template names come from
`STAFF_OTP_TEMPLATE_AR` / `STAFF_OTP_TEMPLATE_EN` (`packages/notifications/src/templates/staff-otp-preparation.ts:13-16`).
`TRUSTED_PROXY_CIDRS` must be set or the WhatsApp intake refuses to start (`apps/api/src/main.ts:108-109`).

**Messages to customers and to the team** — closed in production by code:

- The production worker never builds the tenant WhatsApp module: `apps/worker/src/main.ts:111` (`if (!production)`).
  It builds the in-app module, whose WhatsApp path throws `NOTIFICATIONS_LIVE_REQUIRES_PR6`
  (`apps/worker/src/modules/notifications/notifications.module.ts:222-229`).
- The template registry is created with defaults: only the `staffOtp` definition and **no approved names**
  (`packages/notifications/src/configuration.ts:46-48`, used at `notifications.module.ts:84,230`). Without a name,
  `prepare` returns `CONFIG_INVALID` (`configuration.ts:61-64`). There is no environment key that supplies a name for
  any template other than the OTP one.
- The only producer of a customer WhatsApp message is the rating request (`rating_request`,
  `apps/worker/src/modules/customers/events/published.ts:63-66`); the rating track is postponed. Team alerts by
  WhatsApp are row 62b, which waits for an ADR on reading team contacts.

**What cannot work on day one without approved templates:** every WhatsApp message. Meta delivers a business-initiated
message only from an approved template; there is no free-text path in this code and none is allowed by Meta outside a
customer-opened 24-hour window. Staff sign in with their PIN on the paired device instead (works with OTP off).

**Templates to submit to Meta now** (approval is the long pole; submit before the code is ready):

| Template | Category | Languages | Needed by the first salon? | Copy in the repo |
|---|---|---|---|---|
| `staff_otp` | AUTHENTICATION | ar, en | Only if staff must sign in from their own phones by code; PIN on the device covers day one | `packages/notifications/src/templates/staff-otp.ts:12`, marked `TODO(spec)` — the copy itself needs Waleed's approval |
| `rating_request` | UTILITY (to confirm with Meta) | ar, en | After launch (ratings are postponed) | not in `packages/notifications`; to be written with the rating slice |
| team alerts (late, not clocked in, low rating…) | UTILITY | ar, en | After launch (row 62b) | the in-app copies under `packages/notifications/src/templates/` are the starting text |

**STOP handling.** Meta's webhook must be subscribed to the production API so that a customer's "stop" suppresses the
number (ADR-0013). Waleed subscribes the webhook in the Meta app with `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, confirms it
works, and only then sets `WHATSAPP_STOP_SUBSCRIPTION_CONFIRMED=true`. `WHATSAPP_STOP_BUTTON_ID` stays empty until
a template with a STOP button is approved (`deploy/staging.env.example:50-51`). The webhook path was not looked up in
this pass; the implementer reads it from the API's WhatsApp intake before Waleed registers it.

## 4. What Waleed does, in order

1. Generate production VAPID keys (push) — day one.
2. Submit `staff_otp` ar/en to Meta, after approving the copy.
3. Create the Resend account, verify the domain in Cloudflare DNS, decide the sender name and address.
4. Answer the email question in section 2.
5. After Meta approves: subscribe the webhook, confirm STOP, hand the manager the template names.
