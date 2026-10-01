# Feature Specification: Personal in-app notifications

**Feature Branch**: `feat/p1-04b-in-app-notifications`
**Created**: 2026-10-01
**Status**: Implementation specification
**Input**: Phase 1 PR 4b — store, list, mark read and admin bell.

## User Scenarios & Testing

### User Story 1 - Read my notifications (Priority: P1)

A signed-in company member opens the bell to see their latest messages and unread count.
**Why this priority**: operational alerts must reach their intended person privately.
**Independent Test**: two users in one company see different inboxes.
**Acceptance Scenarios**:
1. INAPP-01: Given an event addressed to a platform user, consuming it creates one unread message; redelivery creates none.
2. INAPP-02: Given another user's message in the same company, listing and counting never reveal it.
3. INAPP-03: Given multiple messages with equal timestamps, pages are newest first with no overlap or omission.

### User Story 2 - Acknowledge messages (Priority: P1)

A member marks one message or all their messages read.
**Why this priority**: the badge must reflect messages still needing attention.
**Independent Test**: marking messages twice preserves the first read time.
**Acceptance Scenarios**:
1. INAPP-04: Read and read-all are idempotent and cannot change another user's rows.
2. INAPP-05: A missing or foreign notification id returns the same successful no-op acknowledgment.

### Edge Cases

- A removed, future or expired membership cannot select the company.
- Devices and API keys cannot access personal inbox endpoints.
- Missing/unsupported locale, unknown template/revision or unsafe parameters reject the event transaction without storing free text or emitting success.
- Consumer failure rolls back inbox rows, result events and consumer dedupe together.
- Polling and mutation failures show localized errors; changing company shows only that company's inbox.

## Requirements

### Functional Requirements

- FR-001: Store only the event's explicit user recipients and template identity with safe ordered parameters.
- FR-002: Users can read/count/acknowledge only their own notifications in the selected company.
- FR-003: Redelivery cannot create duplicate messages, even after source-event retention.
- FR-004: The bell shows unread count, read/unread state, empty/loading/error states, single-read and mark-all actions in Arabic and English.
- FR-005: The inbox refreshes every 60 seconds; no live stream is required.
- FR-006: Existing WhatsApp authorization and delivery remain unchanged.

### Key Entities

- In-app notification: company, platform recipient user, optional business/branch, source event, template/revision/locale/ordered safe values, creation and first-read timestamps.

## Slice design

### Business rules

- BR-001: Uniqueness is company/source event/recipient user/template key; revision and locale cannot bypass dedupe.
- BR-002: Read acknowledgment is monotonic: null to first read timestamp only.
- BR-003: Personal inbox access needs an authenticated user session and an active membership in the selected company, but no role permission. This is personal acknowledgment, not administration of notification delivery. `view:notifications:business` still governs the separate delivery log.

### Schema changes

`in_app_notifications`: PK `(company_id,id)`, `recipient_user_id` FK to global `user(id)`, nullable business/branch tenant-qualified FKs, template key/revision/locale, safe parameters JSON array, created_at/read_at, source_event_id. No source-outbox FK: identity survives retention. ENABLE/FORCE RLS with company SELECT/INSERT/UPDATE policies for pospay_app; no auth/dispatcher/DELETE grants. Immutable identity and monotonic read trigger; branch/business consistency checked on insert.

RLS keys on company because a database-only worker inserts recipients without a user session and uses the same restricted role. Every API list/count/update keys on the verified session user inside withTenant. The shared selected-company guard rechecks active membership via withUser before entering the tenant, matching workspace discovery; it never trusts principal membership hints. Business/branch are message context, not additional permission filters: the producer explicitly selected this recipient.

Indexes: unique dedupe key (covers source event/company), company/business, company/branch, recipient-user FK index, `(company_id,recipient_user_id,created_at DESC,id DESC)`, and partial unread index with the same order where read_at IS NULL. All indexes are created with the new table; no concurrent rebuild.

### API contract

- GET `/v1/me/notifications`: cursor and limit (default 20, max 100), returns template identity/locale/parameters/context/timestamps and next_cursor.
- GET `/v1/me/notifications/unread-count`: `{count}`.
- POST `/v1/me/notifications/{id}/read` and `/v1/me/notifications/read-all`: `{ok:true}`, HTTP 200; no Idempotency-Key since monotonic acknowledgment has no money/stock effect.
- All four use `@Authenticated()` and selected-company guard; required `x-company-id`; device/key principals refused. Errors: BAD_REQUEST, UNAUTHENTICATED, FORBIDDEN, NOT_READY with existing bilingual envelopes.
- Zod schemas and generated OpenAPI in contracts; generated clients in admin and pos. Reads live in queries; writes in separate use cases with repository/clock ports.

### Permissions

No new permission or feature flag; selected-company membership plus recipient ownership is authoritative (BR-003).

### Events

- Existing notification-request consumer accepts discriminated `IN_APP` user recipients as well as unchanged `whatsapp` phone recipients.
- Successful insert emits `NotificationDelivered` using the existing result envelope: attempt_id is the inbox id, channel IN_APP, recipient_user_id, status SENT, evidence IN_APP_STORED. This means durable inbox creation, never user read. No provider, phone/hash, parameters, queue authorization or network work.
- Initial supported in-app template is `generic_notice`, revision 1, safe ordered `subject` text. Its definition is allowlisted in notifications and ar/en rendering in i18n. `staff_otp` is sensitive and cannot reach IN_APP. Future alert producers add their own safe definitions/catalog keys.

### Test plan

- Template unit: supported locale/revision, exact ordered descriptors, unsafe values and sensitive-template refusal; rendering in ar/en.
- Integration: INAPP-01 through INAPP-05, unread count, revoked/future/expired membership and same-company/cross-company ownership negatives; mixed-channel and rollback proof.
- RLS: restricted app cross-company read/update zero, insert/upsert/FK/re-home rejected; no context leak or auth/dispatcher/DELETE access.
- Queries: list/unread exact DTO shapes and EXPLAIN ANALYZE asserts ordered/partial index use.
- Admin: badge count, list/read state and mark all invalidation using generated client with TanStack Query.

## Success Criteria

### Measurable Outcomes

- SC-001: All isolation scenarios expose zero messages belonging to another person or company.
- SC-002: Repeated acknowledgment and redelivery produce zero duplicate messages and preserve read times.
- SC-003: Users can acknowledge all visible unread messages with one action in either supported language.

## Assumptions

- Technical choices: opaque cursor includes full timestamp plus UUID tie-break; latest 20 entries in bell, paginated API available for later inbox screen.
- The producer owns recipient selection; user FK confirms a platform identity without a contact lookup.
- Scope is PR 4b only, with no new dependency, cross-module arrow, SSE, retention job or business-alert producer.
