# Contract: my preferences

Two interfaces: the account endpoints (step 12) and the device cookie (step 7).

## `GET /v1/me/preferences`

- **Guard**: `@Authenticated()` — session only, personal to the caller. No permission string. The handler requires `principal.userId`, as `me/workspaces` does.
- **Refused**: no session and staff-purpose sessions (`UNAUTHENTICATED`, 401, refused before the controller); a device token, which has no user (`FORBIDDEN`, 403).
- **Response 200**:

```json
{ "navStyle": "A" }
```

`navStyle` is `"A"`, `"B"`, `"C"` or `null` (never chosen).

## `PUT /v1/me/preferences`

- **Guard**: `@Authenticated()`, with `principal.userId` required. The write changes only the row of the session's user, inside the operation. The route is registered in `AUTHENTICATED_WRITES` in `apps/api/src/modules/identity/http/authenticated-writes.ts` (checked at start-up through `route-coverage.ts`) (PP-7.1).
- **Idempotency-Key**: not required. No money or stock effect; repeating the request gives the same result.
- **Ordering**: the server keeps the last write it receives. The client is responsible for order: one tab sends its saves one at a time and replaces a waiting save with the newest choice, so choosing A then B quickly can never end with A stored.
- **Request**:

```json
{ "navStyle": "B" }
```

`navStyle` is required and is `"A"`, `"B"`, `"C"`, or `null` to return to the default.

- **Response 200**: the saved value, same shape as `GET`.

## Errors

Envelope `{ code, message_ar, message_en, details? }` (CLAUDE.md §6).

| Code | When |
|---|---|
| `VALIDATION_FAILED` | `navStyle` missing or not one of the allowed values |
| `UNAUTHENTICATED` | No session, or a staff-purpose session |
| `FORBIDDEN` | A device token (no user) |

## Schema source

Zod schema in `packages/contracts/src/identity/me-preferences.ts`; the generated OpenAPI and the admin client follow from it. No hand-written duplicate type.

## Cookie `pospay_nav_style`

| Property | Value |
|---|---|
| Values | `A`, `B`, `C`. Anything else is read as the default, C |
| Written by | The admin app, on every style choice, and on both sign-in paths (password and TOTP) before entering the dashboard when the account has a value |
| Cleared by | A successful sign-out; sign-in when the account has no value; sign-in when the account read fails or does not answer within 2 seconds (the user then starts on C and sign-in is never held up). The 2-second limit bounds the whole read — the fetch and the body decode together — and the cookie is committed exactly once: an answer that arrives after the limit changes nothing |
| Read by | The admin server layout, per request, before rendering the frame. The account value is fetched uncached |
| Attributes | Same as `pospay_locale`: `Path=/`, one-year `Max-Age`, `SameSite=Lax`, `Secure` on HTTPS |

The cookie carries a display choice only. It is not trusted for anything else and grants nothing.
