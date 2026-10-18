# ADR-0047 — Client response schemas strip unknown keys

- **Status:** Accepted
- **Date:** 2026-10-18
- **Decided by:** issue #351 (the deploy-window failure found on PR #344). Stripping is the rule; a forced reload was rejected.

## Context

Admin and POS bundles parse HTTP response bodies with the Zod schemas in `packages/contracts`. Many of those schemas are `z.strictObject` (or `z.object(...).strict()`), so a key the schema does not name fails the parse.

A release that adds a response field ships the API before every open tab loads the new bundle. A tab that is already open, or a POS device still on a cached bundle, keeps the old strict schema. The new field is an unknown key, the parse throws, and the screen fails until the tab is reloaded. PR #344 hit this with `employee_number` on `sessionPerformerOption`: the reception performer picker rejected every non-empty page. Schemas that were already `z.object` (for example `employee`) dropped the new key and kept working.

The window is the overlap between the new API and an old bundle. It is not limited to one screen. Every response schema a client parses has the same failure the next time a field is added.

Forcing a reload when the API version changes was the other option. It was rejected. The POS writes the sale locally first and keeps an offline queue. A reload throws away unsaved sale lines and can drop queue entries that have not synced. The cashier would have to start the sale again, and a queue entry that is only in memory would be gone.

Request bodies, query strings, path params, cursors, and inbound payloads (webhooks, and any payload the server accepts from outside) are the opposite case. An unknown key there is a client bug or a payload we did not agree to store. Those schemas stay strict so a typo or an extra field is rejected instead of being ignored.

## Decision

1. A response schema that admin or POS parses strips unknown keys. It does not fail the parse. Nested objects inside that response strip as well, so a new field on a nested object does not fail the old bundle either. The parsed value does not contain the unknown key.
2. The constructor for that rule is `responseObject(shape)` in `packages/contracts`. It is `z.object(shape)` under one name, so a new response schema does not grow a second, stricter habit. New response schemas that a client will parse use `responseObject`, including nested objects; the one exception is in §5. Request, query, params, cursor, and inbound-payload schemas stay `z.strictObject` (or `.strict()`).
3. A schema that is also a request field stays strict. The response that embeds the same fields uses its own `responseObject` copy, so the request still rejects an unknown key. `attendanceQrToken` stays strict because the clock request parses it; the issue response that carries it is the exception in §5. `serviceCommissionRule` stays strict for create and update; the service response uses a stripping copy of the same members. The same split covers `scheduleShift` (set-schedule and templates stay strict; the staff schedule, the grid and default shifts embed a stripping copy), `permissionOverrideInput`, `packageTypeComponentInput`, and `passkeyBindingStatus` (no admin or POS screen parses that status schema itself; `employeePasskeyHistory` embeds a stripping copy).
4. Response schemas that no client parses are left as they are. Events, jobs, and server-only payloads are not part of the open-bundle failure.
5. One response stays strict on purpose: `attendanceQrIssue`, the attendance QR envelope that carries the signed kiosk token. The POS pins that in `read-attendance-qr.spec.ts` (an unexpected key such as a stray secret is refused, not dropped). The branch display object inside it (`attendanceQrBranch`) strips like any other response. The criterion is a response whose strictness a client test pins deliberately, not "anything with a URL or a credential"; presigned URLs (`fileUploadTicket`, `fileDownload`) and the IBAN view strip, and the server-side strict switch (§7) is what guards them against leaking a field.
6. Stripping is forward compatible for one deploy window. The old bundle ignores the new field and keeps the fields it knows. It does not keep the unknown key, and it does not treat the unknown key as data.

7. The strip is the default everywhere except the API test runs. `responseObject` is strict only when `POSPAY_STRICT_RESPONSES=1`, and only the API test configs (`apps/api/vitest.config.ts`, the smoke config) set it, so an API test that parses a real response with these schemas fails on a leaked field (an IBAN, a salary, a phone number). The production server, the OpenAPI generator (`pnpm contracts:openapi`, run without the flag), the admin bundle and POS never set it, and all of them strip. The flag must not be exported in a shared pipeline step that also builds admin or POS.
8. Values the client echoes back unchanged are not stripped: the upload ticket `headers` are a loose object, so a new signed header reaches the storage PUT.
9. The in-app notification envelope and page strip unknown keys. The typed `safe_parameters` tuples and the `template_key` union stay strict, because a tuple needs its element types for the generated client. An open bundle can still receive a notification whose `template_key` it does not know, so the admin bell reads the page through `readInAppNotificationPage`: it parses the envelope, then each item on its own, and skips only an item whose `template_key` this bundle does not know or whose `template_revision` is newer than the one it renders. A known template and revision with bad parameters still throws, so a server defect stays visible. The skipped item shows after the new bundle loads; the unread count still comes from the server.

## Consequences

- Adding a response field no longer breaks an admin or POS bundle that is already open, as long as the old schema parsed that response with `responseObject`.
- OpenAPI components generated from those schemas no longer set `additionalProperties: false`. Request components that stayed strict still do. The published document changes only by that difference.
- A server bug that sends a private or misspelled field is no longer caught by the client parse. The field is dropped. Request validation still rejects an unknown key.
- A schema shared by a request and a response cannot be one Zod object. The response copy strips; the request copy stays strict.
