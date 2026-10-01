# Receive platform WhatsApp STOP — Phase 1 PR 5

Accepted design: ADR-0013 §§1–5 and owner decisions; ADR-0018 authorization fence.

GET/POST `/v1/webhooks/whatsapp` are named public, Redis-limited routes. GET verifies the
subscription token in constant time; POST verifies the original bounded JSON body with the Meta
app secret before envelope processing. Valid messages changes for the configured WABA/sender are processed; unexpected entries, changes
or messages are skipped and counted without identifiers. Batches above 100 are split into bounded
transactions so every valid STOP can commit before 200. Statuses have no effect. Text is classified by
whole-message trim/NFKC/English case-fold against the five approved words. The configured approved
button id alone is accepted; a missing button configuration accepts no button. START and cancellation
words are OTHER. No re-subscription or removal route exists.

Global messaging control comprises suppression, permanent digest inbox and append-only audit.
Only platform phone HMAC and a domain-separated complete-message-id HMAC persist. Scrubbed JSON
contains allowlisted structural fields, finite commands and hashes; no original body, phone or
provider id leaves verified intake memory. Queue data contains inbox UUID only.

Intake inserts sorted digests, acquires sorted common phone locks, applies new STOP and audit,
then commits within a bounded 200 ms READ COMMITTED transaction before enqueue and HTTP 200.
Deadline/lock timeout, unknown commit and queue unavailability return logged 503; unexpected failures return logged INTERNAL_ERROR; redelivery reconciles by permanent digest.
Worker sweep recovers unfinished enqueues; processing is idempotent by database markers.
Worker retention clears only JSON after 30 days. Suppression/digest/audit never expire.

The intake facade uses pospay_notifications with exactly ADR-0013 column grants and no tenant
access. Readiness rejects role/ACL/constraint/function drift. pospay_app may execute only the boolean
reader-owned definer after acquiring the existing transaction lock. NULL-only CHECK plus denied
opt-in column writes make Phase 1 monotonic. Manual additions remain an approved capability for the future operator tool; no unused application
factory or manual endpoint ships in this slice. The classified schema/grants still support audited additions.

Verification: signature/raw bytes/handshake/limits/envelope/privacy and full batch traversal;
restricted-role and privileged CHECK negatives; exact ACL/definer inventory and readiness drift;
two-tenant real STOP/authorization races in both orders, rollback, concurrent digest delivery,
unknown commit and enqueue/crash recovery; retention and replay; deterministic domain-separated
complete-id HMAC and missing-key fail-closed handling. Production in-app and inbound processing
are independent; outbound dispatch and OTP stay disabled until PR 6's approved admission binding.

TODO(spec): the owner-approved STOP button id is supplied through WHATSAPP_STOP_BUTTON_ID;
no identifier is invented by this slice.
