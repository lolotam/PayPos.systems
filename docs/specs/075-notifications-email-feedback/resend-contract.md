# Resend contract — what the provider documents, and where the spec differs

Checked **2026-11-23** against Resend's public documentation, before any code (spec 075, plan §"Before code").

## 1. Signature: headers and signing string

Source: [Verify Webhooks Requests](https://resend.com/docs/webhooks/verify-webhooks-requests) and
[Svix — Verifying payloads manually](https://docs.svix.com/receiving/verifying-payloads/how-manual).

| Fact | Value |
|---|---|
| Headers | `svix-id`, `svix-timestamp`, `svix-signature` (the prefix can be white-labelled to `webhook-` on some plans; Resend uses `svix-`) |
| `svix-id` | the unique message id; **the same value when the same webhook is resent** — the dedupe key |
| `svix-timestamp` | seconds since epoch |
| `svix-signature` | a **space-delimited list** of `version,base64-signature` pairs, e.g. `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=`; other versions (`v2`) may appear and are ignored |
| Signed content | `` `${svix_id}.${svix_timestamp}.${raw_body}` `` — the **raw** body; the signature is over the exact bytes |
| Key | HMAC-SHA256 with the **base64-decoded part of the signing secret after the `whsec_` prefix** (`Buffer.from(secret.split('_')[1], 'base64')`) |
| Comparison | constant-time; the generated signature must match **one** of the listed signatures |

The implementation uses native `node:crypto` (no SDK, ADR-0014 §3), verifies over the raw body before
the body is parsed, compares in constant time against every `v1` entry, and requires the timestamp to
be within ±5 minutes.

**Difference from `spec.md` FR-002:** the spec says "the decoded secret" without naming the prefix.
Confirmed: the secret is `whsec_<base64>` and the key bytes are the base64-decoded payload. The
implementation accepts a `whsec_`-prefixed secret (prefix stripped) or a bare base64 secret, and
refuses a secret that decodes to fewer than 16 bytes.

## 2. Event types

Source: [Event Types](https://resend.com/docs/webhooks/event-types).

All six events of the allowlist exist with exactly these names:
`email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`,
`email.delivery_delayed`.

Resend also publishes `email.sent`, `email.opened`, `email.clicked`, `email.received`,
`email.scheduled`, `suppression.added`, `suppression.removed`, domain, contact, topic and inbox
events. None of them is in the allowlist: the intake acknowledges them with 200 and stores nothing
(spec 075 FR-003).

## 3. Bounce classification

Source: [email.bounced](https://resend.com/docs/webhooks/emails/bounced) and
[Email Bounces](https://resend.com/docs/dashboard/emails/email-bounces).

* The field is `data.bounce.type`; the sibling fields are `data.bounce.subType`,
  `data.bounce.diagnosticCode` and `data.bounce.message`.
* The documented values are `Permanent` (hard bounce), `Transient` (soft bounce) and `Undetermined`;
  the event-types page shows the example value `Permanent`, while one example spells the soft bounce
  `Temporary`.
* **Difference from `spec.md`:** the spec's column holds our own vocabulary
  (`PERMANENT` / `TRANSIENT` / NULL), not the provider's wording. The implementation normalises
  `Permanent` → `PERMANENT`, `Transient`/`Temporary` → `TRANSIENT`, and **anything else → NULL**, so
  an unrecognised or `Undetermined` bounce can never suppress an address (owner decision ET-Q2:
  a transient bounce is evidence only).

## 4. Retrieval of a sent email

Source: [Retrieve Sent Email](https://resend.com/docs/api-reference/emails/retrieve-email).

`GET https://api.resend.com/emails/{id}` with a worker-only `full_access` API key returns the sent email, and the
documented response **includes**:

* `id` — the same id the webhook's `data.email_id` carries;
* `tags` — an **array** of `{ name, value }` (the send-time tags; the API reference example shows
  `[{ "name": "category", "value": "confirm_email" }]`), so the three correlation tags
  (`company_id`, `attempt_id`, `execution_id`) are retrievable;
* `to` — the **recipient addresses** (`["delivered@resend.dev"]`).

So the plan's stop condition (`GET /emails/{id}` does not return the tags → the design cannot be met
as written) **does not trigger**: the retrieval returns both the tags and the recipient. The tenant
resolution of PR-C1b therefore keeps the authenticated path of ADR-0014 §3 — the signed callback
supplies only the candidate email id, and the tags come from the provider's own authenticated
retrieval. The tags in the webhook body are **never** trusted and are dropped before storage.

## 5. The payload the intake keeps

Source: [email.bounced](https://resend.com/docs/webhooks/emails/bounced) — the event body.

The signed body carries `type`, `created_at` and a `data` object with `email_id`, `message_id`,
`from`, `to`, `subject`, `template_id`, `tags` and the `bounce` object. The allowlist keeps
`type`, `created_at`, `data.email_id` and `data.bounce.type` only; everything else (addresses,
subject, headers, tags, diagnostics) is dropped before storage and never logged.

## 6. The digest key — an owned key, independent of the signing secret

The permanent event digest is `HMAC-SHA256(digest key bytes, 'pospay:notifications:resend-event:v1\0'
|| svix-id)`. The digest key is its own managed secret (`RESEND_EVENT_DIGEST_KEY`, 32+ characters,
API only) and **not** the webhook signing secret: if the provider re-signs and resends an old
`svix-id` after a signing-secret rotation, a secret-keyed digest would change and create a second
inbox row and job for the same event. With the owned key the dedupe identity survives every
signing-secret rotation. FR-006 and FR-024 explicitly permit this extra managed key that is neither a sending credential nor a recipient
hash key — it can never resolve an address and never send. Domain separation keeps the digest
distinct from the signature, and the raw provider event id never leaves the verified-intake
memory: only the digest reaches the database.

The digest key is frozen: never rotate it except through a documented migration preserving existing
dedupe identities. Missing or invalid configuration leaves the intake NOT_READY (503) with a clear
capability log; it never crashes API startup or affects `/ready`.

Retrieval requires `full_access`; `sending_access` cannot retrieve sent emails or correlation tags
([Resend API key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key), verified 2026-11-24).
