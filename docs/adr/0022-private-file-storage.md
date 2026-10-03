# ADR-0022 — Private files, S3 adapter and asynchronous verification

Date: 2026-10-03. Status: Accepted for Phase 1 PR 12 implementation.

## Context

CLAUDE.md §2.1 requires ObjectStorage and R2/S3-compatible adapters; §8 requires
untrusted-content inspection and full image re-encoding. Network transfer and
image decoding can exceed 200 ms and belong in the worker. No storage package
exists. Owner decision 2026-10-03 settles the allowlist, size cap and retention.

## Decision

Add pinned @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner (3.1146.0) to
packages/storage. They supply maintained S3 signing/transport for private R2 and
generic S3/Garage behind ObjectStorage; do not implement cryptographic signing.
Add file-type 22.1.1 for byte-based MIME detection and sharp 0.35.5 for complete
image decoding/re-encoding in bounded memory. Explicitly approve sharp's install
script; these are the only new direct third-party dependencies for this slice.
Primary references: [AWS SDK S3 examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html),
[sharp constructor](https://sharp.pixelplumbing.com/api-constructor/),
[sharp metadata defaults](https://sharp.pixelplumbing.com/api-output/).

Use 120-second PUT and 60-second GET URLs. Sign content-length/content-type;
confirmation independently enforces byte count and detected MIME. Owner decision 2026-10-03 fixes PDF/JPEG/PNG at 10 MiB each; credentials activate
uploads without a policy setting. Environment configuration cannot widen it.
Verification runs on files-verify BullMQ with company/object ids only, outside
DB transactions. DB leases plus conditional publication support retries. Every
verification writes to a fresh private key, so replay of an old PUT cannot mutate
a verified object. No provider error, key, URL or bytes escape into logs.

Expose existing live authorization through a shared application token bound in
identity.module.ts. This is general access plumbing, not a files→identity business
read/import arrow. No permissions are automatically granted to tenant roles.
Download is POST because it issues a capability and durably audits access; GET
metadata remains a read-only query with result-shape/EXPLAIN tests.
Use a fake S3 server for offline adapter tests; no dev/staging/production compose
changes. The fake validates signed headers via an independent signature check.

## Consequences

API/worker build dependencies include storage. Optional settings never affect
service readiness. Image CPU/native binaries run only in the worker, with explicit
pixel and byte caps. No disk storage or public bucket fallback exists. Bucket
CORS must permit PUT content-type/content-length for the intended app origins.
Browser computes content-length; callers supply exact-size byte bodies.
Access audit measures URL issuance, not each HTTP GET at R2. A previously issued
URL can work for its remaining short lifetime. Owner decision 2026-10-03 retains verified files until authorised deletion or
replacement, deletes never-confirmed objects after 24 hours and rejected objects
seven days after rejection. Two hourly tenant-scoped BullMQ jobs process at most
50 objects per run, with recoverable leases, confirmation fencing and atomic
delete tombstone/system audit. FileUploadRequested is appended with creation;
outbox delivery idempotently registers the two schedules outside transactions.
No global tenant-reader privilege is added. Tombstones keep permanent audits.

Owner decision 2026-10-03 delegates employee-document grants to PR 7a: owner,
general manager, and business manager for their own business. No role_permissions
changes are made here; the stored read permission remains authoritative.

Keep node:24-alpine in both production Dockerfiles. Their final stages execute a
one-shot sharp-backed JPEG/PNG inspection after bundling production dependencies, so the existing CI Docker
build checks the musl native binary and bundled production dependencies. Local
Docker build/run evidence is reported separately; no compose changes are needed.
