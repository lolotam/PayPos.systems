# ADR-0058 — Rating-only public menu shell

- Status: Accepted (connection option 1)
- Date: 2026-11-05
- Slice: [60-2](../specs/060-ratings-and-staff-app/spec.md)
- Connection decision: option 1 — independent public-route CORS

## Context

RT-Q11 requires a separate rating-only `apps/menu` deployable on its own address.
Next.js is already the approved framework. ADR-0011 limits disclosure to the
business name and rating form, with completion and opt-out until expiry.
The pre-slice API CORS header allowlist omitted `x-rating-token` and obtained origins
from `AUTH_TRUSTED_ORIGINS`. A public page origin must not silently gain login trust.

## Independent implementation

The manager authorized the shell, bilingual RTL page, generated-client hooks and
mocked-response UI tests while the transport answer is pending (2026-11-05).
The shell has no authentication, analytics, tracker, service worker or persistence.
The bearer remains in the URL fragment and transient memory, travels only in the
dedicated header, and is absent from query keys, markup and metadata.
Requests omit credentials and disable HTTP caching. Query caches are isolated per
link, garbage-collected immediately when unused, and contain only business name/state.
API base URL is configured using `NEXT_PUBLIC_API_URL`; missing configuration fails
closed. The page calls the API origin directly using its generated-client hooks.

The shell sets no-store, no-referrer, noindex and frame/content-type protections.
Only existing workspace and repository libraries are used. No database changes.

## Decision

Waleed selected option 1 in the PosPay manager conversation on 2026-11-05.
Verbatim: «رقم اختيارك في سؤال CORS بتاع صفحة التقييم-1».
The manager relayed the answer and scope at 15:30; the slice's owner-question
record retains the answer, date, channel and interpretation.

The existing Fastify CORS plugin chooses the policy per request. Only the exact
paths `/v1/ratings/view`, `/v1/ratings/submit` and `/v1/ratings/opt-out` use the
public policy. The allowed origin is exactly the configured `RATING_PAGE_ORIGIN`,
never a wildcard or reflected arbitrary origin. It is empty/disabled by default.
Startup validation rejects a non-origin value (credentials, path, query, fragment
or multiple origins). The template contains only a synthetic placeholder.
HTTP origins are allowed only with explicit `NODE_ENV=development` or `NODE_ENV=test`;
all other environments, including an unset `NODE_ENV`, require HTTPS.

The public policy omits credentials and cookies, permits GET for view and POST for
submit/opt-out (plus OPTIONS), and allows only `content-type` and `x-rating-token`.
It exposes `retry-after` and marks preflight responses no-store. Actual rating
responses retain their existing no-store/no-referrer admission headers.
The client uses `credentials: 'omit'`; public controllers do not create sessions.
Authenticated CORS remains on its existing origin/header/method allowlists.
The page origin never enters `AUTH_TRUSTED_ORIGINS` or login trust.

## Alternatives considered

1. **Selected: separate public CORS policy.** Limit it to view, submit and opt-out,
   the page's exact origin, no credentials, and the dedicated token header.
   Keep login trusted origins unchanged. Requires API preflight/isolation tests.
2. **Same-origin gateway.** Proxy only those three endpoints. Preserve a verified
   client IP through an explicitly trusted proxy chain so the shared per-IP limit
   remains effective. Do not log or cache bearer headers or bodies.

The gateway option is not implemented. No hostname, authentication-origin,
server, DNS, Traefik or Dokploy environment change is part of this PR.
Deployment and live verification remain separate, unperformed work.

## Consequences

HTTP injection tests cover the exact public-route CORS policy, refusal of other
origins, absent credentials/cookies, default-disabled public CORS and unchanged
authenticated CORS. UI tests use mocked HTTP responses.
At staging deployment, the API needs `RATING_PAGE_ORIGIN` set to the actual rating
page HTTPS origin; the menu build needs `NEXT_PUBLIC_API_URL` set to the API origin.
The manager handles those settings and deployment with Waleed. This PR does not
prove a live deployment. Rating-message activation remains closed under spec SC-004.
