# Feature Specification: The employee-app link and QR in the back office (MOB M-1g)

**Feature Branch**: `docs/069-mob-employee-link-qr`

**Created**: 2026-10-24

**Status**: Draft — owner questions EL-Q1 … EL-Q5 pending ([owner-questions.ar.md](owner-questions.ar.md))

**Input**: Track MOB, plan row M-1g of [spec 065's plan](../065-mob-app-shell/plan.md). APP-Q9 (Waleed and Abu Salem,
2026-10-23, final) decided that an employee connects the «PosPay Business» app, and the web personal page, to her
business by **both** the manager's link and a QR code (spec 065 FR-011, FR-012, FR-014). The app reads that link
(B1, merged) and will scan the QR (M-1h). No back-office screen gives the manager the link or the QR today: this spec
adds it.

**Scope.** One screen in `apps/admin` that shows the employee-app link of a business and its QR code, with the actions
EL-Q4 decides. Out of scope: the in-app scan (M-1h), sending the link by SMS or WhatsApp from the server (no outbound
message is added), and any change to how the employee signs in (OTP on her own phone, ADR-0027).

**A fact that shapes this spec.** Today's link is
`https://<pos host>/personal?company=<company-id>&business=<business-id>` (ADR-0027, spec 065 FR-012). It names a
business, **not an employee**: the employee proves who she is with the code sent to her own phone. The link is a
routing hint, never a permission (ADR-0027, BR-002 of spec 065), so it is not a secret. Whether the screen keeps one
link for the whole business or gives each employee her own is **EL-Q1, still pending** (`TODO(spec)`); this spec is
written for the recommended answer, and its Assumptions say what the other answer changes.

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

1. **Given** a manager allowed by EL-Q3 with a business open, **When** she opens the screen, **Then** it shows the
   business name and the link for that business, built from the environment's POS address (FR-002).
2. **Given** the screen, **When** she presses «نسخ اللينك», **Then** the exact link is on her clipboard and the
   screen confirms it for a few seconds.
3. **Given** a user that EL-Q3 does not allow, **When** she opens the screen's address, **Then** she sees the
   back office's normal «no access» state and no link (FR-005).

---

### User Story 2 - The QR on the wall (Priority: P1)

Laila prints the QR page and sticks it near the reception. A new employee opens the app, picks «حسابي كموظفة», scans
the QR (M-1h), and is connected to «الأميرة» without anyone sending her anything.

**Why this priority**: APP-Q9 chose the QR as well as the link; M-1h scans exactly this QR.

**Independent Test**: the QR shown on screen decodes to exactly the link of User Story 1 (FR-003).

**Acceptance Scenarios**:

1. **Given** the screen, **Then** it shows a QR code whose content is exactly the link, large enough to scan from a
   printed A4 page (FR-003).
2. **Given** the print action of EL-Q4, **When** she prints, **Then** the page holds only the business name and its
   logo (when it has one), the QR, the link as text and one line telling the employee what to do (FR-004, as EL-Q4
   describes), with none of the back office's menus.

---

### User Story 3 - A manager of several businesses (Priority: P2)

Laila also manages «الأميرة 2». Each business has its own link and QR; the screen follows EL-Q5 to show the right one,
and never a business she cannot manage.

**Independent Test**: with two businesses, the link and the QR change with the business shown, and each decodes to
its own `business` value.

**Acceptance Scenarios**:

1. **Given** a manager of two businesses, **When** she views the screen for one business, **Then** the link and the
   QR carry that business's id and its company id, and the business name matches.

### Edge Cases

- **The POS address is not set for the environment** (FR-002): the screen shows a clear «the link is not set up for
  this environment» message and no link or QR, never a link to a wrong host.
- **The business has no logo**: the print page shows the name only.
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

- **FR-001**: The screen shows **one link per business** (the same for every employee of that business), unless EL-Q1
  decides otherwise: `https://<pos host>/personal?company=<company-id>&business=<business-id>`, the exact form spec 065
  FR-012 accepts. It never carries an employee's name, phone or id. [NEEDS CLARIFICATION: EL-Q1]
- **FR-002**: The POS host comes from the environment the back office runs in (staging and production differ), never
  from the browser's own address, and never typed by the manager. When it is not set, FR-002's edge case applies.
- **FR-003**: The screen shows a QR code whose content is byte for byte the link of FR-001, so the app's scan (M-1h)
  and its paste (FR-012 of spec 065) read the same thing.
- **FR-004**: The manager's actions on the screen are those EL-Q4 decides (copy the link always; the QR always; printing
  and a WhatsApp share button as EL-Q4 says). A WhatsApp share, if chosen, only opens WhatsApp on the manager's own
  device with the link filled in; the system sends nothing. [NEEDS CLARIFICATION: EL-Q4]
- **FR-005**: Who may open the screen follows EL-Q3, checked by the server on the screen's own read (Slice design),
  never only in the menu (`CLAUDE.md` §8). The menu entry shows only when that read succeeds. [NEEDS CLARIFICATION: EL-Q3]
- **FR-006**: Where the screen lives in the back office follows EL-Q2. [NEEDS CLARIFICATION: EL-Q2]
- **FR-007**: With several businesses, the screen shows the business EL-Q5 decides, and only businesses the manager
  may manage. [NEEDS CLARIFICATION: EL-Q5]
- **FR-008**: The screen writes nothing: no setting, no record and no audit entry, since it only shows identifiers the
  manager already has.

### Key Entities

- **Employee-app link**: derived, never stored: the POS host of the environment, the company id and the business id
  (and an employee hint only if EL-Q1 picks one link per employee, `TODO(spec)`).

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: The link gives no access by itself (ADR-0027): whoever opens it still needs the code sent to her own
  phone. `TODO(spec)` EL-Q1: with the recommended answer the link names the business only, so Sara and Huda of
  «الأميرة» get the same link; with one link per employee each gets her own.

### Schema changes

None. Nothing is stored (FR-008).

### API contract

- **One new read endpoint, for access and the name together (FR-005).** No existing read fits: the employee list
  answers an empty page, not a 403, to a caller without `manage:employees:business` (`list-employees.query.ts`), and
  the business identity read is guarded by `manage:business-identity:business`, a different permission. So:
  `GET /v1/businesses/{businessId}/staff/employee-app-link` · guard `@Require(<the EL-Q3 permission>)` on the
  business (for the recommended answer `manage:employees:business`, DENY wins) · staff feature · read-only, so no
  `Idempotency-Key` · response (Zod in `packages/contracts/src/staff/employee-app-link.ts`):
  `{ company_id, business_id, business_name_en, business_name_ar | null }`, plus `has_logo`. Staff owns no business table, so the
  names come through a staff port whose adapter calls tenancy's exported `describeWorkspaces` (the `staff → tenancy`
  arrow is declared in `docs/module-map.md`; the build adds the adapter to its reads list), inside the same
  `withTenant` transaction as the guard's read, never a direct query on `businesses`. **Errors:** every refusal is the
  guard's 403 `FORBIDDEN`, whether the caller lacks the permission, a DENY wins, or the business is unknown, of
  another company or one she cannot manage. The answer is the same for all of them, so it never reveals whether a
  business exists. The screen shows the link only after a 200, and the menu entry only when that read succeeds.
- **The logo (FR-004, only if EL-Q4 keeps the print sheet):** a second read under the same guard,
  `GET /v1/businesses/{businessId}/staff/employee-app-link/logo`, returns the logo image when `has_logo` is true. It
  reads it through the files module's logo reader (`readStatementLogo`, ADR-0056 §2–3; the `staff → files` arrow is
  declared), so it needs no business-identity permission. How that reader is exposed to this route is settled in
  `/speckit-plan` against ADR-0056 (`TODO(spec)`, technical); the product result stays the one EL-Q4 describes.
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

- No new permission. EL-Q3 picks which existing one guards the read above and so opens the screen.

### Events

- **Published**: none. **Consumed**: none.

### Test plan

- **Domain unit**: none (no business arithmetic). A pure helper that builds the link from the origin and the two ids
  gets unit tests: exact output, a non-`https:` or empty origin refused, ids placed under `company` and `business`.
- **UI tests (apps/admin)**, each asserting what is on screen (`CLAUDE.md` §9): `EL-T01` the link and the business
  name show for an allowed manager · `EL-T02` the QR's value equals the link · `EL-T03` copy puts the link on the
  clipboard and shows the confirmation; a refused clipboard shows the failure and the link stays visible · `EL-T04` a
  403 on the access read shows the no-access state and no link · `EL-T05` a missing `NEXT_PUBLIC_POS_URL` shows the
  not-set-up message and no QR · `EL-T06` the print view holds only the name, the logo (or the name alone when there is
  none), the QR, the link and the instruction line (if EL-Q4 keeps printing) · `EL-T07` another business selected changes the link and the QR · `EL-T08` a `NEXT_PUBLIC_POS_URL` host that is not one of the shared POS hosts shows the not-set-up message, and the staging deploy check finds the staging POS host in the staging back office's link.
- **Cross-check with the app**: a test in `apps/pos` feeds the admin helper's output to `parseManagerLink` and gets the
  same company and business back, so the two sides cannot drift.
- **Integration (apps/api)**: `EL-I01` an allowed manager gets 200 with the names and ids · `EL-I02` a caller without
  the EL-Q3 permission gets 403, and a DENY on the business wins over an ALLOW · `EL-I03` an unknown business,
  another business of the same company she cannot manage, and a business of another company all get the same 403 ·
  `EL-I04` the logo read returns the image when there is one and 404 `NOT_FOUND` when there is none, under the same
  guard.
- **Queries**: no new `queries/` file reads a table (the names come through the tenancy port); the adapter gets a
  result-shape test.
- **RLS negative**: no new table; the read runs under `withTenant`, so EL-I03's other-company case is the negative
  test.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager gets the link for her business in under 30 seconds from opening the back office.
- **SC-002**: The printed QR, scanned by the app (M-1h), connects to the right business on the first try.
- **SC-003**: No employee is ever asked to type a company or business id (ADR-0027).

## Assumptions

- The link works on the web personal page today, so this screen is useful before the app is in the stores.
- One link per business is enough because the employee identifies herself by phone OTP; if EL-Q1 picks one link per
  employee, this spec gains an employee hint in the link and a change to spec 065 FR-012, in a new owner round.
- The screen's look (layout, sizes) follows `packages/ui` and the other staff screens; the print page is plain black
  on white so it prints on any printer.
