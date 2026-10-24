# Implementation Plan: The employee-app link and QR in the back office (MOB M-1g)

**Branch**: `docs/069-plan-logo-addendum` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: [spec.md](spec.md), on Waleed's batch 71 picks (EL-Q1 … EL-Q5, 2026-10-24); Abu Salem pending. If he picks
differently, the spec's «If Abu Salem picks differently» paragraph applies and this plan is revised in a docs PR.

## Summary

A page «تطبيق الموظفات» in the back office's staff menu shows the business's employee-app link
(`https://<pos host>/personal?company=…&business=…`), its QR, copy, a WhatsApp link and a print sheet with the salon
logo. Access and the business name come from the existing `GET /v1/me/workspaces`. The logo comes from one new
audited read in API `files`, designed in the
[ADR-0056 addendum of 2026-10-24](../../adr/0056-attendance-statement-reads-and-logo-reader.md#addendum-2026-10-24--the-employee-app-screens-logo-read-in-the-api-spec-069-m-1g).
Two sub-PRs: the screen without printing first, then the logo read and the print sheet together (spec 069: printing
never ships without the logo).

## Technical Context

**Language/Version**: TypeScript (the repo's pinned versions), Next.js `apps/admin`, NestJS (Fastify) `apps/api`

**Primary Dependencies**: `qrcode.react` (already in `apps/admin`), `packages/ui`, `packages/i18n`, `packages/storage`
(`presignDownload`), `@pospay/db` (`readBusinessIdentity`). No new dependency.

**Storage**: no new table. The logo read writes the existing `file_access_audit` and `audit_log`.

**Testing**: Vitest UI tests in `apps/admin` (visible outcome, `CLAUDE.md` §9); API integration tests on the T2 compose
Postgres (ADR-0006); a cross-check test in `apps/pos` (the admin link helper's output through `parseManagerLink`).

**Target Platform**: the back office in a browser; the link opens the web personal page today and the app after M-2.

**Project Type**: web app (admin) + API

**Performance Goals**: the logo read is one small transaction and a local URL signature, well under 200 ms
(`CLAUDE.md` §6); the page itself makes no new request apart from it.

**Constraints**: no new permission, no new table, no storage IO in a request or a transaction (ADR-0046 §4), every
delivered logo audited (`CLAUDE.md` §8), `NEXT_PUBLIC_POS_URL` limited to the app's POS hosts.

**Scale/Scope**: one page, one API route, one exported identity lock, two port rows and one read arrow.

## Constitution Check

| Rule | How this plan meets it |
|---|---|
| One use case per PR (`CLAUDE.md` §1) | 069-1 is UI over an existing read; 069-2 is the one logo use case and the print sheet that needs it |
| No business logic in controllers / components (§4.2) | the link is built by a pure helper; the logo decision is the `files` use case |
| Module boundaries (§4.1) | the new `files → identity` read arrow and two port rows are declared by the ADR-0056 addendum and in `docs/module-map.md` in 069-2 |
| Every route guarded (§6) | the logo route is `@Authenticated()` + `SelectedCompanyGuard`, listed in `AUTHENTICATED_WRITES` (PP-7.1) |
| Guard connection budget (§6, PP-7.2) | one transaction for the check, the reads and both audits; none nested |
| Clock and ids injected (§4.3) | the audit id from `IdGenerator`, the time from `Clock` |
| Uploads / private files (§8) | the logo is a private file: audited per issued URL, 60-second URL, `no-store` |
| i18n, RTL, `packages/ui` (§7) | every label a catalog key, logical properties only |
| UI tests assert what is seen (§9) | EL-T01 … EL-T10 assert screen states |

No violation; Complexity Tracking is empty.

## Sub-PRs

| Row | What | Files (main) | Depends on | Done when |
|---|---|---|---|---|
| 069-1 | The page without printing: link, QR, copy, WhatsApp | `apps/admin/src/staff/employee-app-link/` (page, link helper, QR, copy, WhatsApp link), the route under `apps/admin/app/(dashboard)/staff/`, the staff-menu entry and the employees-page button; `packages/i18n` keys; one shared POS-hosts constant used by `apps/pos/vite.config.ts` and the admin helper; `NEXT_PUBLIC_POS_URL` in `apps/admin/next.config.ts`, `.env.example`, `deploy/Dockerfile.admin` and **both** admin image builds in `.github/workflows/ci.yml` (staging with `https://pos.staging.pospay.systems`, production with `https://pos.pospay.systems`, since the value is baked into the image); the staging deploy check of the link host | spec 069; the web manager's OK on the `apps/admin` lane; Waleed sets the staging build arg | EL-T01 … EL-T05, EL-T07 … EL-T09 green; the `apps/pos` cross-check green; on staging the page shows the staging POS host's link |
| 069-2 | The logo read and the print sheet | API `files`: `use-cases/issue-business-logo-download/`, its controller route, ports `BusinessMemberReach` and `BusinessLogoReference` and their adapters; identity's exported `lockBusinessMemberReach`; `packages/storage` `presignDownload` optional cache policy; `docs/module-map.md` rows; `AUTHENTICATED_WRITES` entry; contract in `packages/contracts/src/files/`; the admin print sheet and its logo fetch | 069-1; the staging CORS rule below set by Waleed; the ADR-0056 addendum accepted with this PR; **before production:** the production CORS rule set by Waleed, with his yes, before any production deploy that carries 069-2 | EL-I01 … EL-I05 and EL-T06, EL-T10 green; the three staging CORS cases below pass; a printed sheet on staging shows the salon logo; the addendum's status reads Accepted |

## Decisions (research)

- **D-1 — Access and names from `me/workspaces`.** EL-Q3 lets any back-office user open the page, and
  `GET /v1/me/workspaces` already returns the caller's own memberships with business names, read inside `withUser` and
  `withTenant`. Alternatives rejected: a new guarded staff read (only needed if Abu Salem narrows EL-Q3); the employee
  list (answers an empty page, not a 403).
- **D-2 — The link helper is pure and shared by tests.** `employeeAppLink(origin, companyId, businessId)` returns the
  exact FR-012 form or `null` for an origin outside the shared POS hosts. The `apps/pos` cross-check feeds it to
  `parseManagerLink`.
- **D-3 — The POS hosts in one constant.** `pos.staging.pospay.systems` and `pos.pospay.systems`, today written in
  `apps/pos/vite.config.ts`, move to one shared constant both apps import, so the admin cannot produce a host the app
  refuses.
- **D-4 — The logo goes through an audited signed URL**, the `IssueDownload` pattern: the check and the audit commit,
  then a local signature, 60 seconds. Alternatives rejected: streaming the bytes through the API (storage IO in a
  request); the file's stored permission (hides the logo from most EL-Q3 users). See the ADR-0056 addendum.
- **D-5 — WhatsApp is a plain link** `https://wa.me/?text=…` with its own line; no API call, no phone read.
- **D-6 — Printing is a print-only view** of the same page (`@media print`), black on white, with only the name, the
  logo, the QR, the link and the instruction line.

## Technical decision EL-TQ1 and the storage CORS rule

Waleed picked (a) on 2026-10-24 ([owner-questions.ar.md](owner-questions.ar.md) §6): the bucket lets the back office
read the signed logo URL, so the print sheet tells a missing logo (name only) from a storage error (retry). Waleed
applies it himself, before 069-2 is tested on staging. **Add** this rule to the **staging** bucket's CORS and keep the
existing upload (`PUT`) rule of ADR-0022 unchanged:

  ```json
  {
    "AllowedOrigins": ["https://app.staging.pospay.systems"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": [],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
  ```

- **Origins:** the back office only (ADR-0001 §6), never `*`, the POS host or the API host. The production bucket gets
  the same rule with `https://app.pospay.systems` **before** any production deploy that carries 069-2, a production
  change that needs Waleed's yes; without it every logo fetch fails CORS and printing stays blocked.
- **Methods:** `GET` only. The page reads the object with a plain `fetch(url)` and no custom header, which is a simple
  request: no preflight, so `AllowedHeaders` stays empty and `HEAD` is not needed.
- **ExposeHeaders:** none; the page needs the status code and the response body, which CORS exposes for an allowed
  origin. It prints the name only for a 404 whose body code is `NoSuchKey`; a 404 with another code such as
  `NoSuchBucket` (an outage) or an unreadable body is a failure with a retry, and 403 (an expired URL) asks for one new
  URL first.
- **MaxAgeSeconds:** 3600, an hour of cached preflight answers (none are expected for a simple GET).
- **Check after setting it, on staging, three cases** (part of 069-2's done-when): (1) a business with a logo: the
  print sheet shows it and the console has no CORS error; (2) a signed URL for a deleted object: `fetch` reads the 404
  and its `NoSuchKey` body (so the bucket sends `Access-Control-Allow-Origin` on error answers too) and the sheet prints
  the name only; (3) an expired URL: `fetch` reads the 403 and the page asks for one new URL. If (2) or (3) comes back
  as an opaque network error, R2 does not expose its error answers. 069-2 then stops, and EL-TQ1 goes back to Waleed
  with that fact, since every missing logo would show the retry message, which is option (b)'s outcome.


## Project Structure

```text
docs/specs/069-mob-employee-link-qr/
├── spec.md
├── plan.md                  # this file
├── owner-questions.ar.md    # EL-Q1 … EL-Q5 (product), EL-TQ1 (technical)
└── checklists/requirements.md

apps/admin/src/staff/employee-app-link/   # 069-1 page + helper, 069-2 print sheet
apps/admin/app/(dashboard)/staff/employee-app-link/page.tsx
apps/api/src/modules/files/use-cases/issue-business-logo-download/   # 069-2
apps/api/src/modules/identity/persistence/business-member-reach.ts   # 069-2, exported from identity/index.ts
```

**Structure Decision**: the page lives in the admin's `staff` area beside the employees page (EL-Q2); the logo read lives
in API `files`, which owns the audit and storage (ADR-0056 addendum).
