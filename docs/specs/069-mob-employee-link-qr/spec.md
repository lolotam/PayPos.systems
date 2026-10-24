# Feature Specification: The employee-app link and QR in the back office (MOB M-1g)

**Feature Branch**: `docs/069-mob-employee-link-qr`

**Created**: 2026-10-24

**Status**: Draft. EL-Q1 … EL-Q5 (batch 71, PP-56.1 … PP-56.5) were answered by Waleed and by Abu Salem on 2026-10-24
([owner-questions.ar.md](owner-questions.ar.md)) and are final. On EL-Q3 Abu Salem picked «the people who add and edit
employees», not Waleed's «anyone in the back office», and his pick binds (`CLAUDE.md` §1 5b); this spec follows it.
His note on EL-Q2 awaits a clarification that does not change this spec yet.

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

1. **Given** a user who may add and edit employees of that business (EL-Q3) with a business open, **When** she opens the screen, **Then** it shows the
   business name and the link for that business, built from the environment's POS address (FR-002).
2. **Given** the screen, **When** she presses «نسخ اللينك», **Then** the exact link is on her clipboard and the
   screen confirms it for a few seconds.
3. **Given** a user without that permission, **When** she opens the screen's address,
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
- **A changed business link**: never happens on its own. The link and its QR change only if the business id changed,
  which it does not, so a printed sheet stays valid.
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
  and its paste (FR-012 of spec 065) read the same thing. This QR is **fixed**: it names only the company and the business, so it is
  printed once and keeps working. It is not the attendance QR on the counter device, which changes every minute and is a
  different code for clocking in (EL-Q4 note, Abu Salem).
- **FR-004**: The screen offers (EL-Q4): «نسخ اللينك»; the QR; «طباعة» for a print sheet (the business name and its
  logo, the QR, the link and the line «نزّلي تطبيق PosPay Business وامسحي الكود»); and a WhatsApp button. The WhatsApp
  button is a plain link `https://wa.me/?text=<its own line and the link, URL-encoded>`; its line is «افتحي اللينك ده
  عشان توصّلي تطبيق الموظفات بصالون <اسم الصالون>», not the print sheet's «scan the code» line, since she receives a link: it opens WhatsApp on
  the manager's own device with that text typed, she picks the recipient, and the system sends nothing (no outbound
  message is added, no phone is read).
- **FR-005**: Only a user who may add and edit employees of the business may open the screen (EL-Q3, Abu Salem): the
  existing permission `manage:employees:business` on that business, a DENY winning, as on the employees page. The
  server decides it on the screen's own read (Slice design), never only in the menu (`CLAUDE.md` §8); the menu entry
  and the employees-page button show only when that read succeeds.
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

- **The screen's read (FR-005, EL-Q3).** `GET /v1/businesses/{businessId}/staff/employee-app-link` · guard
  `@Require('manage:employees:business', { business: 'businessId' })` (DENY wins) · the staff feature, as the
  employees endpoints · read-only, so no `Idempotency-Key` · a `queries/` read (`CLAUDE.md` §6) · response (Zod in
  `packages/contracts/src/staff/employee-app-link.ts`): `{ company_id, business_id, business_name_en,
  business_name_ar | null }`. The names come through a staff port, `EmployeeAppLinkNames`, whose adapter calls
  tenancy's exported `describeWorkspaces` (the `staff → tenancy` arrow is declared; the module map gains its port
  row). **Errors:** every refusal is the guard's 403 `FORBIDDEN`, whether the caller lacks the permission, a DENY
  wins, or the business is unknown or of another company, so the answer never says whether a business exists. The
  screen shows the link only after a 200, and a 403 shows the no-access state.
- **The logo (FR-004, the print sheet).** The salon logo is a stored file, so showing it is a private-file access
  with its audit (`CLAUDE.md` §8). No existing read serves it to this screen: `readStatementLogo` is worker-only and
  needs a file id and a render id (ADR-0056 §2–3), and the business identity read needs another permission. **How**
  the logo reaches the screen is the [ADR-0056 addendum of 2026-10-24](../../adr/0056-attendance-statement-reads-and-logo-reader.md#addendum-2026-10-24--the-employee-app-screens-logo-read-in-the-api-spec-069-m-1g):
  `POST /v1/businesses/{businessId}/employee-app-link/logo-download` in API `files` returns a 60-second signed URL
  after the audited check. EL-TQ1 (technical) is decided: Waleed allowed the back office to read it (CORS `GET`, plan.md). It is not an owner question: if writing it turns up a choice the owners must make, that
  question is recorded in [owner-questions.ar.md](owner-questions.ar.md) and asked then. This spec fixes only what it must satisfy:
  - **Access:** the same guard as the screen's read, `@Require('manage:employees:business', { business:
    'businessId' })` with the staff feature, so every refusal is the guard's 403; the screen then shows no-access and
    does not print. A permitted user of a business with no logo gets 200 with `download_url: null`.
  - **One transaction, then the image:** resolving the logo file and both audit records (the
    `file_access_audit` row and the `file`/`access` `audit_log` entry, as ADR-0056 §3 does, in the module that owns
    `file_access_audit`) run in **one** `withTenant(company, …, { userId })` transaction, after the guard, so the two
    records and the signed URL commit together or not at all. The image is delivered only after
    that commit, outside any transaction. Because it writes, it is a use case, not a `queries/` read (`CLAUDE.md` §6), and its ids come
    from the injected `IdGenerator`.
  - **Settled by the addendum** (not repeated here): the read lives in API `files`; it learns `logo_file_id` through
    `@pospay/db` `readBusinessIdentity` with no `files → settings` import; it
    issues a 60-second signed URL, signed inside the audited transaction, with `Cache-Control: private, no-store`; and
    the screen tells a missing logo from a failure by the storage answer (CORS `GET`, EL-TQ1).
  - **When the logo cannot be shown:** a bound logo whose stored object is missing counts as no logo, and the sheet
    prints with the name only, as ADR-0056 does for statements. A storage error or timeout shows «اللوجو مش متاح
    دلوقتي، جرّبي تاني» with a retry, and the sheet does not print without the logo in that case.
  - **Delivery:** the print action ships together with this read, never without it. The link, copy, QR and WhatsApp
    button may land first; the print sheet lands complete, with the salon logo as EL-Q4 describes.
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

- No new permission: the existing `manage:employees:business` opens the screen and the logo read (EL-Q3, Abu Salem).

### Events

- **Published**: none. **Consumed**: none.

### Test plan

- **Domain unit**: none (no business arithmetic). A pure helper that builds the link from the origin and the two ids
  gets unit tests: exact output, a non-`https:` or empty origin refused, ids placed under `company` and `business`.
- **UI tests (apps/admin)**, each asserting what is on screen (`CLAUDE.md` §9): `EL-T01` the link and the business
  name show for a holder of `manage:employees:business` on the open business · `EL-T02` the QR's value equals the link · `EL-T03` copy puts the link on the
  clipboard and shows the confirmation; a refused clipboard shows the failure and the link stays visible · `EL-T04` a 403 on the
  screen's read shows the no-access state and no link, and the menu entry is hidden · `EL-T05` a missing `NEXT_PUBLIC_POS_URL` shows the
  not-set-up message and no QR · `EL-T06` the print view holds only the name, the logo (or the name alone when there is
  none), the QR, the link and the instruction line · `EL-T07` another business selected changes the link and the QR · `EL-T08` a `NEXT_PUBLIC_POS_URL` host that is not one of the shared POS hosts shows the not-set-up message, and the staging deploy check finds the staging POS host in the staging back office's link · `EL-T09` the WhatsApp button's link is `https://wa.me/?text=` with the WhatsApp line (not the print line) and the link URL-encoded, and pressing it sends no request to the API.
- **Cross-check with the app**: a test in `apps/pos` feeds the admin helper's output to `parseManagerLink` and gets the
  same company and business back, so the two sides cannot drift.
- **Integration (apps/api)**: the screen's read: `EL-I07` a holder gets 200 with the names and ids · `EL-I08` no
  permission, a DENY on the business, an unknown business and another company's business all get the same 403. The
  logo read: `EL-I01` a holder gets a signed URL · `EL-I02` the same four refusals get the guard's 403 · `EL-I09` a permission revoked after the guard but before the use case's own check gets the same 403 and
  one `DENY` access audit on the logo file, as `IssueDownload` does · `EL-I03` a
  holder of a business with no logo bound gets 200 with `download_url: null` and no audit record; every URL answer
  writes one `file_access_audit` row and one `file`/`access` `audit_log` entry in the same transaction as the URL
  signature, and a failure anywhere in it, signing included, leaves neither record · `EL-I05` the API answer and the
  signed object answer both carry `Cache-Control: private, no-store` · `EL-I06` a signing or storage-configuration
  failure answers 503 (`STORAGE_UNAVAILABLE` / `STORAGE_NOT_CONFIGURED`) with no audit record · `EL-I04` no session
  gets 401.
- **UI, logo cases (apps/admin)**: `EL-T11` the screen's read succeeds, then the logo request answers 403 (permission
  revoked after the page loaded): the screen shows the no-access state and printing is disabled, never the name-only
  sheet · `EL-T10` a storage failure shows «اللوجو مش متاح دلوقتي، جرّبي تاني» with a retry and no print, while a
  missing logo object (a 404 `NoSuchKey`) prints the name only, and a 404 `NoSuchBucket` or an unreadable answer is
  treated as the storage failure; a 503 from the logo read shows the same retry message.
- **Queries**: the screen's `queries/` read gets a result-shape test and its own `EXPLAIN ANALYZE` assertion
  (`CLAUDE.md` §9). It runs the statement it reaches through the tenancy port (`describeWorkspaces`) for one
  business and asserts an index scan on `businesses` by `(company_id, id)`.
- **RLS negative**: no new table; EL-I08's and EL-I02's other-company cases are the negative tests.

### EL-Q3 history

Until Abu Salem answered (2026-10-24, 21:36–21:45 Kuwait), this spec followed Waleed's «anyone in the back office»:
access and names from `GET /v1/me/workspaces`, and a logo read with its own membership lock. Abu Salem's binding pick
replaced it with the `manage:employees:business` guard above, which needs no `files → identity` arrow and no lock of
its own. Waleed's answer stays recorded as history in [owner-questions.ar.md](owner-questions.ar.md).

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
