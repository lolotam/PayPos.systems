# Files presigned access — Phase 1 PR 12

Sources: Phase 1 SPEC §2/§3 files rows, §11 V4; plan row 12; CLAUDE.md §2.1/§8/§10.

## Scope and security

Private objects belong to a company and business, optionally a branch, and carry
an owner module/entity reference and a catalogued required read permission.
Staff keeps the verified object key; document metadata/UI belongs to PR 13.
No filename, key or signed URL is accepted when requesting an upload. No bytes go to disk.
Upload staging keys and verified keys are distinct and generated with UUID v7.
PUT capabilities expire in 120 seconds and sign exact content length/type.
GET capabilities expire in 60 seconds, force attachment, and are never logged.
Existing capabilities remain usable until expiry; revocation blocks the next issuance.

## Contract and authorization

- POST /v1/businesses/{businessId}/files/uploads (201): strict
  {owner_module, owner_entity_id, branch_id?, content_type, size_bytes,
  required_permission}; requires manage:files:business and possession of the
  chosen stored permission. Business and branch must belong to the verified tenant.
  Returns {id, upload_url, expires_in, headers}, never a storage key.
- POST /v1/files/{id}/confirm (202): selected company + authenticated session,
  uploader only and live manage:files:business permission. Enqueues an id-only
  BullMQ verification job; repeat confirmation safely re-enqueues the same job.
- GET /v1/files/{id} (200): authenticated selected company; uploader plus live
  manage permission, or live stored read permission. Returns metadata/status;
  storage_key appears only after READY. No signed URL in status.
- POST /v1/files/{id}/download (200): authenticated selected company; fresh
  server-side stored permission evaluation using the recorded business/branch.
  This command issues a capability and writes an immutable access audit before
  returning {download_url, expires_in}. Every successful issuance is audited;
  denied attempts are audited too. It is a command rather than a read-only query.

POST /v1/files/download (200) accepts strict {storage_key}, resolves it using the
company-qualified unique index and performs the same live permission check and
audit as download by id. This lets staff keep only the object key and open its
documents through files without a business-module import.

Unknown, cross-tenant and inaccessible ids/keys return the identical 404 FILE_NOT_FOUND envelope. DENY remains internally audited. Pending/rejected objects cannot
be downloaded. STORAGE_NOT_CONFIGURED closes file capabilities only; empty or
incomplete settings never prevent production API/worker readiness.
Identity's existing authorization engine is exposed through an application shared
token, without a files→identity module arrow or duplicate permission semantics.

## Verification

Worker downloads into bounded memory, detects MIME from content, verifies exact
declared byte length and 10 MiB maximum for each accepted type, and rejects lying types.
JPEG/PNG are fully decoded and re-encoded with metadata removed and a pixel
cap. Unsupported image formats fail closed. Only PDF, JPEG and PNG are accepted (owner decision 2026-10-03). PDF detection establishes file type, not malware
safety; force attachment and private bucket remain required.
Publish only to a fresh verified key after inspection; uploaded staging bytes can
never overwrite a READY object. Worker retries use leases and compare-and-set
publication; a crash before commit cannot expose staging content. Failed content
becomes REJECTED with an allowlisted reason. Transient provider errors retry.

## Schema and migrations

file_objects: tenant PK, business/branch composite FKs, owner reference, staging
key, generated verified key, claimed and detected MIME/size, required permission,
created_by/at, status, verification lease, rejected reason. Permission references
the global catalog. Keys are unique within company. All lookup/FK indexes ship
in the creating migration. FORCE RLS and minimum column grants in a custom RLS
migration; runtime may never change ownership, stored permission or staging key after creation;
only verification updates the generated publication key.
file_access_audit: tenant PK, tenant-qualified object FK, actor, timestamp,
ALLOW/DENY outcome; INSERT/SELECT only. Also append the canonical audit_log entry
inside the same download transaction, with ids and outcome only.

## Owner decisions and retention

Owner decision 2026-10-03: uploads accept content-detected PDF, JPEG and PNG,
10 MiB (10,485,760 bytes) maximum each. Credentials enable uploads without a
separate policy setting; environment values cannot widen the allowlist or cap.

Owner decision 2026-10-03: abandoned uploads (never confirmed) expire 24 hours
after creation; rejected files expire seven days after rejection. Verified files
remain until deleted or replaced by an authorised user; this slice adds no
verified-file deletion/replacement endpoint. Two tenant-scoped worker jobs run
hourly in batches of at most 50 objects. An atomic FileUploadRequested outbox
event registers both id-only BullMQ schedules, avoiding a new global tenant scan
or a database/Redis dual write. Dispatcher retries scheduling failures. No
storage configuration means the event retries, rather than silently disappearing.
Deletion is idempotent, leased and fenced against confirmation/verification.
Confirmation is recorded before queuing; confirmed but waiting/retrying uploads
are never treated as abandoned. Provider failure leaves the deletion claim
retryable. Object tombstones retain immutable audits; successful deletion and
its system-actor canonical audit commit together, without a key or URL.

Owner decision 2026-10-03 (PR 7a grant decision): owner and general manager may
upload/read employee documents, and business manager may do so for employees
of their own business. PR 7a grants manage:files:business and read:files:business
at the appropriate company/business scope. This PR changes no role_permissions.
Stored per-file permission and live authorization remain the read mechanism.
Staff-owned uploads require the stored read:files:business permission; they cannot
substitute a broader permission. PR 13 preserves the employee business as the
file business reference.

## Acceptance tests

F1 pure key builder rejects path injection; type/size mismatch and bounds.
F2 real SDK against a fake S3 HTTP server: constrained PUT/GET signing, bounded
stream, re-encoding, safe errors, private writes; no external storage account.
F3 real Postgres upload/confirm/download, false type rejection, pending refusal,
permission removal/DENY/expiry, fresh permission scope, audit for every issuance.
F4 both tenant tables: cross-tenant reads/writes, composite FK, no context,
runtime grants, immutable audit; status query shape/index EXPLAIN.
F5 contract/OpenAPI and generated clients; built production API/worker smoke
with empty optional settings, ready=200 and guarded files=503 named error.
F6 pnpm db:migrate on pospay_wt_l3c, pnpm check, API and worker builds exit zero.

F7 fixed PDF/JPEG/PNG cap and configuration without a policy setting; rejection
of WebP and other types, content mismatch and oversize bodies.
F8 both retention boundaries, confirmed/verified preservation, tenant isolation,
bounded batches, concurrent confirmation fencing, provider retry and one audit
per deletion; real BullMQ schedules and outbox registration/retry.
F9 sharp native decode/re-encode in both production Docker images, also enforced
by the existing CI Docker build.

## PR #82 review fixes (2026-10-03)

Always evaluate the complete recorded business and optional branch, independent
of the permission suffix. Branch DENY overrides business/company ALLOW for both
metadata and download. Metadata hides inaccessible files with the same 404.

Persist every verified candidate's ownership before the storage PUT. Conditional
publication must own both the verification lease and the unpublished candidate.
A tenant-qualified cleanup ledger records candidate and staging keys internally;
keys never enter audit payloads, Redis or logs. Publication and the pending staging
cleanup entry commit atomically. A cleanup claim fences publication, and published
candidates are permanently excluded from deletion.

The existing hourly retention jobs also sweep at most 50 cleanup entries each.
Verification triggers this bounded sweep immediately, including on job replay of
a READY file. Deletion failures release their cleanup lease for retry. Successful
staging deletion schedules another sweep after the original 120-second PUT has
expired (creation is recorded after signing, plus a one-second boundary margin).
Unpublished candidates wait until the verification lease plus a 20-minute IO grace
has elapsed. Tombstones reconcile daily to remove late/replayed writes even after
an earlier successful deletion. Every first cleanup has one atomic system audit
with file id and artifact kind only. A stale cleanup cannot acknowledge a newer
claim, and no cleanup can delete the published verified key. READY object retention
and owner decision 2026-10-03 remain unchanged.

F10 real authorization: business ALLOW with branch DENY blocks metadata and both
download paths; unknown/inaccessible envelopes match exactly, while DENY audits remain.
F11 provider deletion failure then retry; replayed PUT is removed after expiry
without deleting the verified object; durable ledger survives restart.
F12 ownership exists before PUT; publication failure, lost lease and crash leave
recoverable candidates; bounded, idempotent cleanup, stale-claim fencing, published
key exclusion, tenant RLS negative tests and minimum grants.
