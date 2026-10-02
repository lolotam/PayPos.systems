# ADR-0014 — Email provider for the Phase 1 email channel

- **Status:** Proposed
- **Date:** 2026-10-02
- **Slice:** Phase 1 · G5 · before PR 14 (email channel)

## Context

`docs/06_Tech_Stack_Architecture_EN.md` §1 names **Resend / Amazon SES** without settling the provider. SPEC §2/§9,
D-39 and D-47 require bilingual email for operational alerts, starting with employee-document expiry to owner
and manager. Plan PR 14 depends on PR 4 and G5. The PRD's Resend wording is a lean, not a substitute for this gate.

The existing notification Channel boundary and ADR-0018's commit-before-call execution fence remain in force.
Email provider selection is a business choice: operating time, paid allowance and geography matter alongside
the price per message. This record compares official documentation checked **2026-10-02**; prices are USD before
tax, discounts and ancillary services, and must be rechecked before purchase. No account or dependency is added.

## Decision

### 1. Recommend Resend for the pilot; preserve the Channel boundary

**Recommend Resend Pro**, one platform-controlled verified `send.pospay.systems` sender domain, sending region
Ireland (`eu-west-1`), for Phase 1's operational email. This is a recommendation pending the owner questions,
not an accepted subscription, production configuration or measured deliverability result.

Use a Resend HTTPS adapter in `packages/notifications`, bound only in worker notifications. Producers resolve
email recipients/locale/channels and supply the notification contract; notifications does not read staff/customer
contacts or document content. Templates contain safe alert text and a link to the authenticated admin screen,
never residency/civil-ID scans, salaries or bearer rating links. i18n owns ar/en UI labels; notifications owns
ar/en email copy. Use the current worker/outbox/BullMQ infrastructure, no synchronous provider HTTP in the API,
consumer or DB transaction. Do not add automatic cross-provider failover on uncertain submissions.

Operational simplicity is the reason for the recommendation: a small REST integration and direct signed
webhooks avoid SES-specific IAM signing, sandbox approval and SNS configuration. This is an engineering inference
from the interfaces below, not evidence that Resend reaches more inboxes. SES is a credible later adapter when
volume cost or a Gulf sending region justifies its setup, through a separately accepted choice.

### 2. Resend versus SES

| Dimension | Resend | Amazon SES |
|---|---|---|
| Cost | Free: 3,000/month, capped at 100/day. Pro: $20/month for 50,000, overage $0.90/1,000 when enabled; no daily cap on Pro. [Pricing](https://resend.com/pricing?product=transactional). | New eligible account/region combinations default to Essentials: $0.16/1,000 through 10 million/month. Explicit à-la-carte outbound is $0.10/1,000 plus $0.12/GB of outgoing data; SNS/other services and optional features are extra. Do not budget every new account at the older $0.10 rate without selecting that model. [Pricing](https://aws.amazon.com/ses/pricing/). |
| Deliverability | Domain authentication, managed shared infrastructure, automatic hard-bounce/complaint suppression and a dashboard for diagnostics. [Suppression](https://resend.com/changelog/suppression-list-support). | Domain authentication, regional reputation/quota management, account suppression and optional deliverability tooling. New sandbox accounts need production access. [Production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [suppression](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html). Neither provider guarantees inbox placement; domain/content/recipient quality and real mailbox tests matter. |
| Region | Published sending choices: N. Virginia, Ireland, São Paulo, Tokyo; no Gulf region in that published list. Ireland is the proposed pilot choice. [Regions](https://resend.com/changelog/multi-region-for-everyone). Sending region does not establish residency of all provider logs/backups/control-plane data. | API sending endpoints include Bahrain (`me-south-1`) and UAE (`me-central-1`), plus Ireland and other regions. **SMTP is not available in Bahrain/UAE**, so a Gulf choice uses the API. [Endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html). Identities, quotas and production setup are regional; region alone is not an end-to-end residency guarantee. |
| API | JSON HTTPS `POST /emails`, Bearer API key, HTML/plain text, tags and optional provider idempotency key. Node HTTP can use the documented wire contract. [Send API](https://resend.com/docs/api-reference/emails/send-email). | SES v2 HTTPS `SendEmail`, IAM/SigV4 credentials and regional endpoint; AWS SDK or signed HTTP; SMTP in supported regions. [SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html). More credential/region setup; SDK retries must be disabled to retain ADR-0018's fence. |
| Webhooks | Direct HTTPS events for delivery, bounce, complaint, failure and suppression; signed raw body with Svix id/timestamp/signature headers. Verify authenticity/freshness and dedupe replayed events. [Webhooks](https://resend.com/docs/webhooks/introduction), [verification](https://resend.com/docs/webhooks/verify-webhooks-requests). | Configuration-set event publishing or identity notifications via SNS; HTTPS subscriptions need authenticated SNS intake and subscription setup. Bounce/complaint/delivery events can arrive more than once. [Notifications](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications.html), [SNS verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html). |
| Bounces | Automatically suppresses hard bounces and complaints; distinguish `email.bounced`, `email.complained`, `email.suppressed`, delayed and failed outcomes. No application resend on bounce. [Suppression](https://resend.com/changelog/suppression-list-support), [event types](https://resend.com/docs/webhooks/event-types). | Enable account-level BOUNCE/COMPLAINT suppression in the selected region and process feedback. SES publishes hard bounces and soft bounces after its own retries are exhausted; provider SMTP delivery retries differ from an application's second submission. [Event data](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html), [suppression](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html). |

Illustrative **outbound-only** costs, one recipient per alert, no attachments/free credits/tax:

| Monthly alerts | Resend Pro | SES Essentials | SES explicitly selected à-la-carte |
|---|---|---|---|
| 10,000 | $20 | $1.60 | $1.00 + outgoing-data charges |
| 50,000 | $20 | $8.00 | $5.00 + outgoing-data charges |
| 100,000 | $65 (Pro plus 50 × $0.90 overage buckets) | $16.00 | $10.00 + outgoing-data charges |

These are calculations from the linked prices, not a demand forecast or account quote. SNS/observability,
optional deliverability/IP features and implementation/operating effort are excluded. Pro with overage is the
comparison above, not Resend's separate Scale plan. Confirm alerts/day and recipients before choosing Free;
its daily cap can stop a batch of document-expiry alerts even below the monthly allowance.

### 3. PR 14 implementation contract, feedback and privacy

Reuse the irreversible PENDING → SENDING claim and successful commit acknowledgement before the one provider
submission; unknown commit/timeout/5xx never authorizes a new send. Provider acceptance records `SENT` with
`evidence = PROVIDER_ACCEPTED`, preserving ADR-0018 semantics. A delivery webhook records additional receipt
evidence; it does not retroactively make the original API response proof of recipient delivery or reading.
Provider retries to the recipient's mail server do not permit another application HTTP call.

Extend the tenant attempt contract for canonical email destinations and email recipient hashes; do not reuse
phone hashing, phone_last3 or WhatsApp global STOP tables for email. Clear raw destinations atomically at terminal
states, with unknown-SENDING cleanup governed by ADR-0018. Credentials/signing secrets are platform env/Dokploy
secrets, never tenant event/job JSON or logs; no credential table or tenant-owned sender in the pilot proposal.

Persist an opaque provider-message correlation with the attempt and send immutable company/attempt tags.
Do not assume Resend echoes tags in every webhook: after verifying the callback signature, the owning adapter
can [retrieve that sent email](https://resend.com/docs/api-reference/emails/retrieve-email) by its validated
provider id over authenticated HTTPS, outside any DB transaction, and read only the correlation tags. Discard
the retrieved body/address fields without logging them. Verify the returned id, then use `withTenant` and require
the recorded attempt's provider id to match. Neither tags alone nor an unverified callback resolves authority.
A callback arriving before result
commit is retained as pending feedback, never dropped or treated as a new authorization; PR 14's slice spec
must classify its minimal inbox, grants and retention before any migration. No runtime global tenant scan.
Verify raw-body signature, bounded timestamp, strict payload allowlist and duplicate event id before processing.
Privacy-scrub provider diagnostics and addresses before
persistence/logging; no documents or raw email bodies in the inbox.

Configure provider hard-bounce/complaint suppression before live sending. Record those outcomes visibly, never
resubmit the failed alert, never clear suppression automatically, and do not enable open/click tracking by
default. PR 14 must implement feedback intake/processing or explicitly remain disabled for live email until
that prerequisite ships. Selecting a provider alone does not prove bounce handling or readiness.

No new dependency in this design. Recommend native Node HTTPS for the send adapter. If PR 14 chooses a Resend/
Svix verification SDK or an SES SDK, it must name the exact dependency/version in an ADR amendment before adding
it; this record does not approve an unspecified SDK. Fake/synthetic adapter tests require no live provider account.

### 4. Verification required in PR 14

- Adapter wire contract: verified sender, one destination, ar/en locale without fallback, safe HTML/plain text,
  accepted response, rejection/429/5xx/timeout/malformed reply and no submission retries or redirect following.
- Existing execution-fence crash/concurrency/deadline tests for EMAIL: duplicate events/jobs cause at most one
  call, terminal result/destination clearing/outbox atomicity, unknown SENDING visible without resend.
- Signed callback happy path plus invalid signature, stale timestamp, replay/duplicate, forged company/attempt,
  mismatched provider id, cross-tenant token/tag and callback-before-result-commit races. Tenant tables include
  FORCE RLS, tenant-qualified indexes/FKs and negative isolation tests in their creating PR.
- Delivery/bounce/complaint/suppression interpretation, provider suppression preventing a later attempt,
  privacy/redaction and no open/click tracking. Missing email config leaves api/worker able to start under
  NODE_ENV=production; email readiness is explicitly disabled/unready without blocking unrelated capabilities.
- Before pilot activation, verify sender SPF/DKIM/DMARC and a controlled delivery/bounce/complaint exercise with
  provider feedback. Do not report inbox placement as tested by mocks or a send API's accepted response.

## Alternatives considered

| Alternative | Assessment |
|---|---|
| SES first, regional API in Bahrain/UAE | viable and cheaper per message; prefer it if Gulf sending is required or owner accepts IAM/SNS/production-access work now |
| Resend Free in the live pilot | useful for controlled setup, but 100/day can suppress time-sensitive batches; choose only after volume confirmation |
| Build both adapters/fail over automatically | expands a small channel slice and risks duplicates after uncertain acceptance |
| Self-hosted SMTP or another vendor | outside the two named stack options; adds mail-server reputation/operations or needs another ADR |

## Consequences

- Resend is recommended for lower setup/operational effort; SES wins raw volume cost and offers Gulf sending.
  Keeping Channel isolates a later provider change but does not migrate sender reputation automatically.
- Sender DNS, provider account/paid tier, region approval and bounce feedback are activation prerequisites,
  separate from implementation gates. No live send or purchase has been performed by this documentation change.
- PR 14 extends email destination/feedback contracts with their own privacy tests. It adds no notifications
  contact-reader arrow and does not change WhatsApp STOP or rating-link policy.

## Open questions for the owner

1. **Provider and budget (`TODO(spec)`, G5):** recommend Resend Pro at $20/month for the pilot, with overage disabled
   until a budget alert/cap is agreed. Confirm monthly/daily volume and whether the lower SES bill outweighs
   additional setup. This is the business choice; the ADR remains Proposed until recorded acceptance.
2. **Sending region (`TODO(spec)`):** recommend Resend Ireland if no Gulf processing constraint is required;
   otherwise SES API in Bahrain, with a review of the provider's complete data handling. Region selection alone
   must not be described as guaranteed data residency.
3. **Sender/copy (`TODO(spec)`):** recommend one platform-controlled `send.pospay.systems` domain, bilingual
   operational-only copy, a monitored Reply-To and authenticated admin links without document content.
   Confirm sender display name and mailbox before DNS/provider setup.
4. **Feedback operation (`TODO(spec)`):** recommend hard-bounce/complaint suppression with manual correction only,
   owner-visible failures, no automatic re-subscription/resend and no open/click tracking. Name the operator and
   agree scrubbed feedback retention (recommend 30 days; durable attempt/dedupe identities remain).
