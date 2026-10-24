# Feature Specification: The employee-app link and QR in the back office (MOB M-1g)

**Feature Branch**: `docs/069-mob-employee-link-qr`

**Created**: 2026-10-24

**Status**: Draft — EL-Q1 … EL-Q5 (batch 71, PP-56.1 … PP-56.5) answered by Waleed on 2026-10-24; Abu Salem pending
([owner-questions.ar.md](owner-questions.ar.md)). Work follows Waleed's picks; if Abu Salem picks differently, his
pick replaces Waleed's (`CLAUDE.md` §1 5b) and the paragraph «If Abu Salem picks differently» below says what changes.

**Input**: Track MOB, plan row M-1g of [spec 065's plan](../065-mob-app-shell/plan.md). APP-Q9 (Waleed and Abu Salem,
2026-10-23, final) decided that an employee connects the «PosPay Business» app, and the web personal page, to her
business by **both** the manager's link and a QR code (spec 065 FR-011, FR-012, FR-014). The app reads that link
(B1, merged) and will scan the QR (M-1h). No back-office screen gives the manager the link or the QR today: this spec
adds it.

**Scope.** One screen in `apps/admin` that shows the employee-app link of a business and its QR code, with the actions
of EL-Q4: copy, QR, a print sheet and a WhatsApp button. Out of scope: the in-app scan (M-1h), sending the link by SMS or WhatsApp from the server (no outbound
message is added), and any change to how the employee signs in (OTP on her own phone, ADR-0027).

**A fact that shapes this spec.** Today's link is
`https://<pos host>/personal?company=<company-id>&business=<business-id>` (ADR-0027, spec 065 FR-012). It names a
business, **not an employee**: the employee proves who she is with the code sent to her own phone. The link is a
routing hint, never a permission (ADR-0027, BR-002 of spec 065), so it is not a secret. Waleed picked **one link for the
whole business** (EL-Q1).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The manager gives her team the app link (Priority: P1)

Laila manages «الأميرة». A new employee, Sara, joins. Laila opens the employee-app screen in the back office, copies
the link and sends it to Sara on WhatsApp herself. Sara taps it on her phone, the app (or the web page, while the app
is not installed) opens on «الأميرة», and she signs in with the code sent to her phone.

**Why this priority**: without it, no employee can connect the app except by typing what the app never asks for
(ADR-0027: the UI never asks staff to type identifiers). The link already works on the web today.

**Independent Test**: open the screen as a manager of one business, copy the link, paste it in the app's «عندي لينك»
field: the app connects to that business (spec 065 FR-012).

**Acceptance Scenarios**:

1. **Given** a back-office user (EL-Q3: anyone who uses the back office) with a business open, **When** she opens the screen, **Then** it shows the
   business name and the link for that business, built from the environment's POS address (FR-002).
2. **Given** the screen, **When** she presses «نسخ اللينك», **Then** the exact link is on her clipboard and the
   screen confirms it for a few seconds.
3. **Given** a user with no membership that reaches the business, **When** she opens the screen's address,
   **Then** she sees the back office's normal «no access» state and no link (FR-005).
4. **Given** the screen, **When** she presses the WhatsApp button, **Then** WhatsApp opens on her own device with
   the instruction line and the link already typed; she picks whom to send it to, and the system sends nothing
   (FR-004).

---

### User Story 2 - The QR on the wall (Priority: P1)

Laila prints the QR page and sticks it near the reception. A new employee opens the app, picks «حسابي كموظفة», scans
the QR (M-1h), and is connected to «الأميرة» without anyone sending her anything.

**Why this priority**: APP-Q9 chose the QR as well as the link; M-1h scans exactly this QR.

**Independent Test**: the QR shown on screen decodes to exactly the link of User Story 1 (FR-003).

**Acceptance Scenarios**:

1. **Given** the screen, **Then** it shows a QR code whose content is exactly the link, large enough to scan from a
   printed A4 page (FR-003).
2. **Given** the print action (EL-Q4), **When** she prints, **Then** the page holds only the business name and its
   logo (when it has one), the QR, the link as text and one line telling the employee what to do (FR-004, as EL-Q4
   describes), with none of the back office's menus.

---

### User Story 3 - A manager of several businesses (Priority: P2)

Laila also manages «الأميرة 2». Each business has its own link and QR; the screen shows the business she has open now
(EL-Q5), and she switches business the usual way to see the other one.

**Independent Test**: with two businesses, the link and the QR change with the business shown, and each decodes to
its own `business` value.

**Acceptance Scenarios**:

1. **Given** a manager of two businesses, **When** she views the screen for one business, **Then** the link and the
   QR carry that business's id and its company id, and the business name matches.

### Edge Cases

- **The POS address is not set for the environment** (FR-002): the screen shows a clear «the link is not set up for
  this environment» message and no link or QR, never a link to a wrong host.
- **The business has no logo**: the print page shows the name only.
- **WhatsApp is not installed** (a computer without WhatsApp Desktop): the button opens WhatsApp Web in a new tab;
  copying the link still works.
- **Arabic and English**: every label goes through `packages/i18n`; the link itself is the same in both languages.
- **The employee's sign-in is not enabled on the server** (ADR-0019: OTP delivery may be off): the link still opens
  the right business; whether the code is sent is the server's decision, as on the web today. The screen makes no
  claim about it.
- **The clipboard is refused by the browser**: the link stays visible and selectable as text, and the screen says
  the copy did not work.
- **A link opened on a phone without the app** opens the web personal page of the same business (the same URL, spec
  065); after M-2 the installed app opens it instead (spec 065, O-6).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The screen shows **one link per business**, the same for every employee of that business (EL-Q1): `https://<pos host>/personal?company=<company-id>&business=<business-id>`, the exact form spec 065
  FR-012 accepts. It never carries an employee's name, phone or id.
- **FR-002**: The POS host comes from the environment the back office runs in (staging and production differ), never
  from the browser's own address, and never typed by the manager. When it is not set, FR-002's edge case applies.
- **FR-003**: The screen shows a QR code whose content is byte for byte the link of FR-001, so the app's scan (M-1h)
  and its paste (FR-012 of spec 065) read the same thing.
- **FR-004**: The screen offers (EL-Q4): «نسخ اللينك»; the QR; «طباعة» for a print sheet (the business name and its
  logo, the QR, the link and the line «نزّلي تطبيق PosPay Business وامسحي الكود»); and a WhatsApp button. The WhatsApp
  button is a plain link `https://wa.me/?text=<its own line and the link, URL-encoded>`; its line is «افتحي اللينك ده
  عشان توصّلي تطبيق الموظفات بصالون <اسم الصالون>», not the print sheet's «scan the code» line, since she receives a link: it opens WhatsApp on
  the manager's own device with that text typed, she picks the recipient, and the system sends nothing (no outbound
  message is added, no phone is read).
- **FR-005**: Anyone who uses the back office may open the screen (EL-Q3), for a business her membership reaches; no
  extra permission. That is decided by the server, never only in the menu (`CLAUDE.md` §8): the business must be in
  the caller's own `GET /v1/me/workspaces` answer (Slice design).
- **FR-006**: The screen is a page «تطبيق الموظفات» in the staff menu, and the employees page has a button that opens
  it (EL-Q2).
- **FR-007**: The screen shows the business that is open in the back office now (EL-Q5); switching business switches
  the link and the QR.
- **FR-008**: The screen writes no setting and no business record, since it only shows identifiers the manager already
  has. The only writes are the logo read's two access-audit records (`file_access_audit` and `audit_log`, Slice design),
  because reading a stored file is a private-file access (`CLAUDE.md` §8).

### Key Entities

- **Employee-app link**: derived, never stored: the POS host of the environment, the company id and the business id.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: The link gives no access by itself (ADR-0027): whoever opens it still needs the code sent to her own
  phone. The link names the business only (EL-Q1), so Sara and Huda of «الأميرة» get the same link.

### Schema changes

None. Nothing is stored apart from the logo read's two access-audit records, in the existing audit tables (FR-008).

### API contract

- **Access and the name come from an existing read (FR-005, EL-Q3).** `GET /v1/me/workspaces` (`@Authenticated()`,
  session only; `apps/api/src/modules/identity/http/me.controller.ts`) already returns the caller's own memberships,
  each company with its businesses' `id`, `name_en` and `name_ar`, read inside `withUser` and `withTenant` through
  tenancy's `describeWorkspaces`. The screen shows the link only for the business that is open (EL-Q5) **and**
  appears in that answer; otherwise it shows the no-access state. The menu entry shows for every back-office user,
  as EL-Q3 says. No new endpoint, no new permission.
- **The logo (FR-004, the print sheet).** The salon logo is a stored file, so reading it is a private-file
  access with its audit (`CLAUDE.md` §8). `readStatementLogo` cannot be reused as it is: it is exposed only from the
  worker and needs a file id and a render id (ADR-0056 §2–3), and the logo binding (`logo_file_id`) belongs to
  `settings`. So the API gets its own logo read, **shaped like ADR-0056 §3**:
  - `GET /v1/businesses/{businessId}/employee-app-link/logo`, `@Authenticated()`. The company comes from the
    `x-company-id` header, parsed and refused with 400 `BAD_REQUEST` when it is not an id, exactly as
    `me/memberships` does (`companyHeader` in `me.controller.ts`); the business is never used to look the company up.
  - **It writes, so it is a use case, not a `queries/` file** (`CLAUDE.md` §6), and it carries the write declaration
    of PP-7.1 naming where its access check lives. The audit id comes from the injected `IdGenerator` (`CLAUDE.md`
    §4.3), since a GET has no `Idempotency-Key`.
  - **Phase 1, one `withTenant(that company)` transaction:** check an active membership in that company reaching the
    business and that the business belongs to it; resolve the logo file through settings' public reader; insert the
    `file_access_audit` row and append the `file`/`access` `audit_log` entry, both as ADR-0056 §3 does; commit.
  - **Phase 2, after the commit and outside any transaction:** read the bytes from storage through `files` (ADR-0046
    §4: no storage call inside a tenant transaction) and return them with `Cache-Control: private, no-store`, so a
    cached copy can never skip the check and the audit.
  - **Errors:** one 404 `NOT_FOUND` for an unknown business, a business of another company (invisible inside that
    company's `withTenant`), an unreached business and a business with no logo.
  - Its module, ports and `docs/module-map.md` rows are an **ADR-0056 addendum**, written and accepted with
    `/speckit-plan` (`TODO(spec)`, technical, Waleed). **The print action ships together with this read, never
    without it:** the screen's link, copy, QR and WhatsApp button may land first, and the print sheet lands complete,
    with the salon logo as EL-Q4 describes.
- **POS host (FR-002):** a new build-time variable `NEXT_PUBLIC_POS_URL` for `apps/admin`, set per environment like
  `NEXT_PUBLIC_API_URL`: listed in `apps/admin/next.config.ts` and `.env.example`, inlined at build time through a
  build arg in `deploy/Dockerfile.admin`, and passed by the image build step of `.github/workflows/ci.yml` (for
  staging, beside `STAGING_API_URL`).
  Its value is the full origin, for example `https://pos.staging.pospay.systems`. The screen uses only its host and
  accepts it only when it is an `https:` origin **and** one of the POS hosts the native app accepts
  (`pos.staging.pospay.systems`, `pos.pospay.systems`, today written in `apps/pos/vite.config.ts`): the build moves
  those two hosts into one shared constant that both apps import, so they cannot drift, and any other value shows the
  not-set-up message. A swap between environments is caught after each staging deploy: the deploy check opens the
  staging back office's link host and confirms it is the staging POS host (`EL-T08`).

### Permissions

- No new permission: a back-office session and a membership that reaches the business are enough (EL-Q3).

### Events

- **Published**: none. **Consumed**: none.

### Test plan

- **Domain unit**: none (no business arithmetic). A pure helper that builds the link from the origin and the two ids
  gets unit tests: exact output, a non-`https:` or empty origin refused, ids placed under `company` and `business`.
- **UI tests (apps/admin)**, each asserting what is on screen (`CLAUDE.md` §9): `EL-T01` the link and the business
  name show for a back-office user whose workspaces include the open business · `EL-T02` the QR's value equals the link · `EL-T03` copy puts the link on the
  clipboard and shows the confirmation; a refused clipboard shows the failure and the link stays visible · `EL-T04` an open
  business missing from the workspaces answer shows the no-access state and no link · `EL-T05` a missing `NEXT_PUBLIC_POS_URL` shows the
  not-set-up message and no QR · `EL-T06` the print view holds only the name, the logo (or the name alone when there is
  none), the QR, the link and the instruction line · `EL-T07` another business selected changes the link and the QR · `EL-T08` a `NEXT_PUBLIC_POS_URL` host that is not one of the shared POS hosts shows the not-set-up message, and the staging deploy check finds the staging POS host in the staging back office's link · `EL-T09` the WhatsApp button's link is `https://wa.me/?text=` with the WhatsApp line (not the print line) and the link URL-encoded, and pressing it sends no request to the API.
- **Cross-check with the app**: a test in `apps/pos` feeds the admin helper's output to `parseManagerLink` and gets the
  same company and business back, so the two sides cannot drift.
- **Integration (apps/api), the logo read only**: `EL-I01` a member whose membership reaches the business gets the
  image · `EL-I02` a member of the same company whose membership does not reach that business, an unknown business,
  and a business of another company all get the same 404 · `EL-I03` a business with no logo gets that 404, and every image answer writes one `file_access_audit` row and one `file`/`access` `audit_log` entry, committed
  before the bytes are read · `EL-I05` the image answer carries `Cache-Control: private, no-store` · `EL-I04`
  no session gets 401, and a missing or malformed `x-company-id` gets 400.
- **Queries**: none new (the names come from `me/workspaces`, already tested).
- **RLS negative**: no new table; EL-I02's other-company case runs under `withTenant` and is the negative test.

### If Abu Salem picks differently

- **EL-Q3 «the people who add and edit employees» or «owner and general manager only»:** `me/workspaces` is no longer
  enough. The screen then needs its own guarded read, `GET /v1/businesses/{businessId}/staff/employee-app-link` under
  `@Require(manage:employees:business)` (or the owner/general-manager roles), answering the guard's single 403 for
  every refusal and returning the names through a staff port over `describeWorkspaces`; the logo read moves under the
  same guard.
- **EL-Q4 without WhatsApp, or without printing:** the button or the print sheet (and so the logo read) is dropped.
- **EL-Q1 «one link per employee», EL-Q2 or EL-Q5 another option:** the link gains an employee hint and spec 065
  FR-012 changes (a new owner round); or the screen moves; or it lists every business she reaches.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager gets the link for her business in under 30 seconds from opening the back office.
- **SC-002**: The printed QR, scanned by the app (M-1h), connects to the right business on the first try.
- **SC-003**: No employee is ever asked to type a company or business id (ADR-0027).

## Assumptions

- The link works on the web personal page today, so this screen is useful before the app is in the stores.
- One link per business is enough because the employee identifies herself by phone OTP (EL-Q1); if Abu Salem picks one link per
  employee, this spec gains an employee hint in the link and a change to spec 065 FR-012, in a new owner round.
- The screen's look (layout, sizes) follows `packages/ui` and the other staff screens; the print page is plain black
  on white so it prints on any printer.
