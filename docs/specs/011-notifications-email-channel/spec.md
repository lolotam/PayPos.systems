# Feature Specification: notifications email channel

**Feature Branch**: `feat/p1-14-email-channel`
**Created**: 2026-10-03
**Status**: Implementation scope — live email disabled
**Input**: Lane L5, Phase 1 plan row 14; ADR-0014 and ADR-0018.

## User Scenarios & Testing

### User Story 1 — Safe operational alerts (Priority: P1)

An owner or manager receives operational alerts in their explicit Arabic or English locale.
Acceptance: a synthetic alert snapshots its email destination, commits authorization, submits at
most once, retains provider acceptance evidence and clears its destination with the terminal result.
Missing/unsupported locale, malformed destination, expiry or suppression produces a visible refusal.
Duplicate events/jobs and unknown commit/provider outcomes never permit another submission.

### User Story 2 — Safe deployment before feedback is ready (Priority: P1)

The owner can deploy unrelated capabilities with every optional email setting empty.
Acceptance: production API/worker start and email reports disabled. Even fully populated credentials
and an attempted live mode cannot enable email. With a configured email identity key, disabled requests
are recorded as CONFIG_INVALID in the existing delivery log, with no authorization job or provider call.
Without that key, the source event fails closed with a finite diagnostic rather than creating an
unkeyed recipient identity. PR 15 must not emit live email requests before these prerequisites ship.

### Edge Cases

Expired deadline immediately before HTTPS; 4xx/429/quota refusal; 5xx/timeout/malformed or oversized
response; redirects; crash after acceptance; result write rollback; concurrent jobs; destination cleanup;
mixed in-app/WhatsApp/email events; no locale fallback; unsafe template parameters.

## Requirements

- Native Node HTTPS Resend adapter implements the existing Channel boundary without dependencies,
  submission retries, redirect following, attachments or recipient/body/key diagnostics.
- Exactly one recipient, operational ar/en copy, monitored Reply-To, one platform sender under
  `send.pospay.systems`, authenticated admin link, immutable company/attempt/execution tags.
- Ireland eu-west-1, Resend Pro with overage disabled and open/click tracking disabled are provider
  account prerequisites, not per-send API options or claims this PR has configured an account.
- EMAIL uses the existing ADR-0018 authorization/outbox/BullMQ/PENDING→SENDING protocol, destination
  clearing, unknown-outcome handling, cleanup and owner/manager delivery log. Wire channel is `email`,
  following the existing lower-case `whatsapp` contract.
- Separate domain-separated platform email HMAC and key id; no phone identity, phone suffix or
  WhatsApp STOP storage is reused. Dedupe survives destination clearing.
- **Smaller safe path chosen under ADR-0014 §3:** live email remains unconditionally disabled.
  Signed webhook intake, durable scrubbed inbox/dedupe, authenticated retrieval, NULL-id binding
  under the attempt lock, separate receipt evidence, global hard-bounce/complaint suppression and
  the 30-day scrub job are deferred together. No unauthenticated reconciliation seam ships.
  Unknown attempts remain visible with NULL provider id and cannot resend. A follow-up must classify
  its tables/grants in an ADR-0003-style note before migration and implement all ADR-0014 race tests.
- Existing delivery log displays EMAIL failures/suppression without exposing address/hash/body.

### Key Entities

Tenant attempt: retained keyed recipient identity, temporary canonical email, immutable template/locale,
source identity and execution fence; opaque provider id and finite send diagnostics.

## Slice design

### Business rules

ADR-0014 owner decisions and ADR-0018 transitions are unchanged. No automatic resend, re-subscription,
failover or suppression correction. Copy/mailbox/display name/operator are activation inputs pending
owner approval, explicitly TODO(spec) in code. No financial calculation or contact reader.

### Schema changes

`notification_attempts` remains ADR-0003 tenant data. Add nullable `recipient_email`; make
`phone_last3` nullable only for EMAIL. Channel-specific CHECKs require the correct PENDING destination
and prohibit both destinations at terminal states or mixing channels. Add email destination
anti-repopulation guard. Existing FORCE RLS, app SELECT/INSERT/UPDATE, no DELETE, tenant PK/FKs and
identity/log/status indexes remain; no new table, role, global facade, scan or filter/index is needed.
Generate an expand migration and a separate custom guard migration; never edit existing migrations.

### API contract and permissions

No new endpoint. Extend strict notification recipient/result/log Zod contracts; EMAIL phone_last3
is NULL. Existing delivery-log GET retains exactly `view:notifications:business` and existing
company/business/branch restrictions. Regenerate OpenAPI and generated clients for this contract change.

### Events

Consume existing producer events with event-supplied destinations. Publish NotificationSendAuthorized
and NotificationDelivered/Failed using existing id-only transport and address-free result shape.
Only successfully committed fake-mode attempts may submit in this PR; runtime live email cannot.

### Test plan

Adapter: loopback fake HTTPS, exact wire request and ar/en copy, errors/timeout/redirect/oversize,
deadline, no network retries or private diagnostics. Identity: stable across companies, email/phone
domain separation, canonical domain, exact local part, invalid input. Worker real Postgres: dedupe,
competing processors, unknown commit, provider outcomes, result rollback/retry, suppression seam,
crash/NULL-id/no-resend and cleanup. RLS: EMAIL cross-tenant read/update/insert/FK/rehome/DELETE
denials and destination CHECK/guard. Existing query shape/EXPLAIN plus EMAIL log visibility.
Production smoke: built API and worker with optional notification/email settings empty, bounded
test process/injection, no dev server/browser. pnpm check and touched app builds.

## Success Criteria

Every duplicate/crash test performs at most one submission. Every terminal email attempt has no
destination. Every email diagnostic omits address/body/key. No environment setting enables live email.
Arabic and English operational templates render without fallback; other capabilities remain available.

## Assumptions

ASCII dot-atom email subset; preserve local-part case, lower-case DNS domain, reject whitespace,
quoted local parts and internationalized addresses instead of guessing equivalence. Producers must
supply canonical addresses. Admin link uses a configured, allowlisted HTTPS admin origin and home
screen, with no tokens/query/fragment; a document-detail route belongs to its producer slice.
Tests use synthetic fixtures only. Feedback/reconciliation tests are deferred with the disabled-live
path, not reported as passing. DNS/account/region/tracking configuration and actual deliverability
remain activation work.

## Open questions for the owner

1. Approve ar/en operational copy before activation. Recommend the generic document-expiry copy
   without employee/document details.
2. Assign approved sender mailbox/display name, monitored Reply-To and feedback operator.
   Recommend a dedicated operational mailbox on the accepted sender domain with monitored replies.
