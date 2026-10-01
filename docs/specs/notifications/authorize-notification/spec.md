# Authorize and send a notification — Phase 1 PR 4

Status: implementation. Governing decision: [ADR-0018](../../../adr/0018-notification-delivery.md), sections 1–10.

Producers supply stable source event ids, tenant/business/branch scope and `notification_recipients` containing
canonical synthetic/test or tenant E.164 destinations, explicit locale, channel, immutable template revision,
ordered allowlisted parameters and optional absolute deadline. Notifications never reads contacts.

The database-only outbox consumer locks the platform phone identity, checks the transaction-bound suppression
gate and inserts once by `(company_id, source_event_id, channel, recipient_hash, template_key)`.
An inserted PENDING attempt and NotificationSendAuthorized commit together. Missing/unsupported locale,
expired deadlines, invalid destination/configuration and suppression insert terminal rows with no destination
or sender job. Consumer dedupe uses the existing consumed_events transaction.

The separate transport publisher awaits BullMQ enqueue before acknowledging publication. Only company/attempt
ids enter jobs. A sender reserves admission before its acknowledged PENDING → SENDING transaction; only the
winning execution calls the channel once, outside transactions. Unknown commit acknowledgement gives no
permission to send. The channel checks the deadline immediately before its single bounded HTTP submission.
The fenced terminal update clears the destination and writes its result event atomically; uncertain/crashed
SENDING never retries submission. Explicit cleanup requires execution drain and age ≥24 hours, preserves the
ledger identity/status and writes an audit record.

GET `/v1/notifications/delivery-log`, `/v1/businesses/:businessId/notifications/delivery-log` and
`/v1/branches/:branchId/notifications/delivery-log` use cursor pagination, scoped
`view:notifications:business` guards and SQL DTO projection without destination/hash/parameters. Owner and
manager bundles receive this permission; other roles are denied by default. No resend route or UI.

Required proofs: domain transitions/deadlines/locale/cleanup; restricted-role RLS negatives and terminal CHECK;
duplicate source delivery and competing processors ≤1 call; expiry and locale failures zero calls;
fake acceptance/4xx/5xx/timeout; terminal destination clearing and atomic result events; scoped GET denial;
delivery-log shape and index EXPLAIN. Remaining ADR failure-window proofs can use injected clock, channel
hooks, transaction wrappers and admission/suppression ports.

Database-backed package test suites run in db → auth → API → worker order in Turbo. Their setup and role
negative tests mutate cluster-wide roles; sequencing prevents those mutations and template cloning from
competing across packages against the same local Postgres instance. Runtime timeouts remain unchanged.

Production sends fail closed in PR 4. Fake mode is development/test only. No suppression table, STOP handler,
OTP delivery, rating link transport, in-app store, email/SMS/push adapter or handset callback ships here.

PR 5 binds the real transaction-bound platform suppression gate, signed synchronous STOP intake and
inbox recovery under ADR-0013 Part A. Production in-app processing is independent; outbound and OTP
remain disabled until PR 6 supplies approved admission. The PR 4 delivery semantics above still apply.

TODO(spec): owner-approved staff_otp copy/components/category and Meta names;
PR 6 outbound admission quantities, OTP expiry/cooldown/capacity and recovery UX.
