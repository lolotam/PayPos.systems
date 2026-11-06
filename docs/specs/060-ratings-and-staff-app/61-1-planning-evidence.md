# 61-1 — Planning evidence (companion of `plan-61-1.md`)

> Initial investigation baseline `da775eb5e5b62adcb48b26d1e55fdba1a2ce671f`; authorized A1 base is live
> `319e8c637f063dddb6df5e487d3585f223eb500a`. Owning branch `plan/61-1-low-rating-alert`; isolated planner
> draft `t3/55a01391`. The isolated planner used
> Read/Glob/Grep; no shell, git, test, benchmark, SQL, network or model dispatch. Line numbers are at the baseline.
> Nothing here is an implementation claim.

The owning lead integrated and source-corrected the unapproved draft using read-only shell/Git inspection,
documentation edits and pure synthetic JSON byte arithmetic. There was no production change, test, benchmark,
SQL execution/generation, migration or activation. A1 documentation application/generation and its later check,
review and PR receipts are recorded separately below. This distinction preserves the planner's
tool/reading disclosure rather than attributing the lead's completed reading to that child.

## E0. Manager direction, Arabic original (planning only)

```text
راجعت plan-61-1.md و61-1-planning-evidence.md كاملين. قرارمديرللتخطيط،ليسإذنتنفيذ:
1) أعتمد اتجاهA-1لإضافةAPIcustomers→identityوالـAPIstaffnamesreaderبواجهاتpublicمحددةونفسtx. لاcode/PRحتىإغلاقU3وإرسالdiffADR/modulemapوالتواقيعوالاختبارات/المستهلكينللمراجعة. لاworker→API.
2) أعتمدفصلP-1من61-2كمتطلبسابقمتماسك:catalog/defaults/seed+grantrefusal/current-rolepolicyمعًا، وتحديثdependencygraphحتىلاتبقىالدائرة. هذاقرارترتيبلا إذنmigrationأوتوسيعصلاحيات؛ موافقةوليدقبلالتوليدمازالتلازمة.
3) تقسيمA-1/P-1/kind/templates/emitterمقبولكمرشحتخطيط، ليس5PRsمعتمدة. أثبتكلخطوةقابلةللدمجباستقلالومتوافقةمعالإصدارالسابقواللاحق؛templatesلايُرسلهامنتجقبلوجودconsumerمتوافق، والـlistedkindمعemitterفقط. لايفتحأكثرمنPRواحدبجلسةالتسليم.
4) أكملU1/U2/U3الآنتصميمفقطبنفسالتكليف. اعرضبديلينتقنيينعلىالأكثرلـIN_APPlossless، تتبعكلحقلمنsubmission/outboxإلىDB/API/renderer، exactschemasوالحدودالحاليةوالخصوصيةوالـrollback/versioncompatibility. لاتسميةsafe_parametersبديلًا عنإثباتالتحقق؛ لاchunk/قص/إسقاطأسماءأوteamlabelولاحدperformersمخترع. إذاrepresentationيحتاجتغييرنقلأومخططبيّنهصراحةقبلأيimplementation.
5) عدموجودcapلايسمحبوعدpayloadغيرمحدودضمن1000ms: اعرضحساباتحجمبالـUTF8bytesوعددrecipients/performers ومضاعفةالبياناتبالـbatch، ومسارالفشلatomicقابللإعادةالمحاولةبدونconsumeناقص. لوبقيتعذرالجمع بينالمتطلباتارفعالتعارضبدليُخفىبتقديرحجم؛ لاbenchmarkأوSQLالآن. لازيادةtimeout.
6) حددboundaryالتحققرuntimeقبلappendبمايسمحبهمصفوفةالمعمارية؛أكملقراءةADR0037addendaوبنودقراراتالمالكالمعتمدعليهاقبلالحكمالنهائي. المراجعاتالسابقةللoriginalلا تُحسباعتمادfinal؛ مراجعةمستقلةجديدةبعدإغلاقالتصميم.
7) أصلحجدولGenerated(excluded):الأعدادتشملproduction/tests/docs/generated+/−، لااستثناءتلقائي. أحجامbriefتتحددبعدحسمالنقل؛0217تنسيققديممؤقتولاحجزنهائيقبلlivejournal.
8) اسحبصياغةT1«كلواحدةترجعلوحدها»: فصلmigrationلايعنيSQLreverseمسموح؛rollbackcodeوفقcompatibilityوالـDBمنsnapshotverifiedبحسبالخطة.لاتعرضبطاقةmigrationالآنبلاخطةملموسة.
استمرتصميمًابلاحاجةلقراروليّدحاليًا؛لاsource/tests/SQL/PR/activation. احفظالوثيقتينومرجع888. سلّمنيU1/U2/U3مغلقةأوتعارضًامثبتًا،ثمbriefA1القابلللمراجعة.
```

## E0.1. Latest manager technical decision — A1 delivery only

This is a technical MANAGER decision, not a new quote from Waleed. It authorizes documentation A1 only; it does
not amend deferrals, activate ratings or authorize a seed/migration. Verbatim record:

```text
قرار المدير بعد قراءة A1 patch المصحح، receipt، وتصميم B/U2/U3:
1. أختار B اتجاهًا تصميميًا للـIN_APP فقط، لا إذن بتنفيذ T/K/E. لا أقبل توصية §5.5 باعتبار U2 مجرد verification limit يسمح بتنفيذ E ثم القياس؛ U2 مانع تصميم/جاهزية صريح، لأن safe failure لا يحقق liveness. اترك E محجوزًا حتى خطة قابلة للمراجعة تعالج الحمل ضمن العقد أو تعرض تغييرًا معماريًا محددًا. لا cap/قص/زيادة timeout/إعادة تفسير نجاح التقييم ضمنيًا.
2. أعتمد A1 كتسليم توثيقي مستقل فقط: ADR0010 + module-map.md + YAML عبر generator، ومعهما plan/evidence وحفظ هذا القرار. المتوقع الحالي +903/-3 =906 إجمالي؛ brief1000 شامل جميع الإضافات والحذف والـgenerated والأثر، حد الرفض2000، سقف3جولات. لا قارئ/port إنتاجي أو tests تنفيذية أو migration/seed/permission أو T/K/E. كل reads المستقبلية تبقى comments مخططة، لا entries نشطة بلا adapters.
3. قبل التطبيق احفظ checkpoint والوثيقتين؛ حدّث القاعدة من origin/main الحي عبر المسار المعتمد مع حفظ worktree/backups. main الحالي بعد #882 هو da16aae2c7cb315ee81f911ce637aab3b88cf267؛ تحقق حيًا. ديفك المقترح على da775 لا يُطبّق دون مقارنة السياق الحالي.
4. عدّل status/header و§9 بما يعكس اعتماد A1 وحده واختيار B تصميميًا، وحفظ أن U2/P1 غير محلولين. لا تعرض REQUIRESCORRECTION القديم كـPASS للنسخة النهائية. تحقق UTF-8 بالقراءة الصريحة (مخرجات PowerShell الافتراضية عرضت mojibake؛ ليس عندي إثبات فساد الملف نفسه). شغّل module-map:generate/check وlint:docs وformat/diff اللازمة، ثم مراجعة مستقلة جديدة للديف النهائي قبل PR واحد. لا تختلق tests أوbenchmark. لا حاجة لجولة إضافية منفصلة لمجرد التصحيحين القديمين قبل ذلك.
5. بعد إعداد A1، استكمل خطة P1 فقط: حصر كل writers الفعلية وتحديد guard-before-seed، وكيف يُثبت نشر الحارس على الجميع قبل جعل permission قابلة للمنح، وأرضية rollback. لا توليد migration أو رقم217 محجوز ولا deploy/config. خريطة الاعتماديات يجب أن تفصل هذه البوابة عن docs A1.
6. §3.6 يظل شرطًا معلنًا: لا أجيز تفسيرًا جديدًا يوسع عرض بيانات الهاتف؛ A1 لا يحسم سياسة free-text ولا يعيد RT-Q8/Q9. صياغة أي قرار لازم تكون منفصلة عند خطة T/E النهائية.
التفويض العام من وليد أثناء نومه يسمح لي باختيار التوصيات والدمج مع البوابات؛ لا تغيّر التأجيلات أو activation blockers. سجل هذا كقرار مدير تقني لا اقتباس مالك جديد. نفّذ A1 التوثيقي أعلاه فقط، وأرسل الديف النهائي/الحجم/المراجعة ثم PR؛ الدمج ينتظر الترتيب وبوابات الرأس.
```

Checkpoint: `F:/Dev/Temp/pospay-61-1-planning/before-a1-20261106T223351Z/manifest.txt`, verified SHA256 copies
of both documents and the proposal/receipt. Local ref `backup/61-1-before-a1-20261106T223351Z` preserves the old HEAD;
this is a source checkpoint, not a DEP-1 database backup/restore receipt. #888's retained ref is unchanged.
`git fetch origin` confirmed `da16aae2c7cb315ee81f911ce637aab3b88cf267`; relevant ADR/map/governance files had no
intervening diff. The original branch was fast-forward merged, not rebased or forced. Only then were the ADR/map
hunks applied; generated YAML was excluded from patch application and produced by `pnpm module-map:generate`.
The command succeeded. The five-file final diff and remaining permitted checks/review are the A1 delivery scope.

Before freezing A1, live main advanced again through #893 to `319e8c637f063dddb6df5e487d3585f223eb500a`.
Checkpoint `F:/Dev/Temp/pospay-61-1-planning/before-main-893-20261107T020408378/` preserves both docs (hash-verified)
and the staged patch; ref `backup/61-1-before-main-893-20261107T020408378` preserves `da16aae2`.
The five A1 paths and governing files had no intervening diff. `git merge --ff-only origin/main` succeeded,
preserving the staged A1 changes. This is another source checkpoint, not a database backup/restore receipt.

## E1. Reading record and gaps (full disclosure)

**Read in full this task:** `AGENTS.md`; `CLAUDE.md` (V3.22, system context); `CLAUDE.architecture.md` (A1.0);
`docs/module-map.md` (two pages); `docs/adr/0010-phase-1-ports-and-events.md`; `docs/adr/0037-…` with both addenda
(2026-10-10, 2026-10-23); `packages/config/eslint/boundaries.js`; `packages/db/src/outbox.ts`;
`packages/contracts/src/in-app-notifications.ts`; `packages/contracts/src/notifications.ts`;
`packages/contracts/src/customers/rating-comment.ts`; `packages/notifications/src/templates/definition.ts` and
`generic-notice.ts`; worker `on-notification-request.handler.ts`, `domain/in-app-notification.ts`,
`persistence/drizzle-in-app.repository.ts`, `staff/persistence/performer-names.reader.ts`; API
`customers/use-cases/submit-rating/submit-rating.usecase.ts`, `customers/ports/rating-submission.port.ts`,
`customers/persistence/drizzle-rating-submission-transactions.ts`, `customers/customers.module.ts`,
`identity/persistence/branch-role-holders.ts`, `identity/persistence/company-active-lock.ts`,
`settings/persistence/read-alert-rule.ts`, `notifications/queries/in-app-notifications.query.ts`;
`apps/admin/src/notifications/model/render-notification.ts`.

**Read in part:** `identity/persistence/access-reader.ts` lines 140–204 (`readAccessTransaction`; not the reader class);
`packages/db/src/with-tenant.ts` lines 20–139 (options, `withDeadline`; not `run`); `packages/db/schema/notifications.ts`
lines 28–77 and 95–134; schema CHECK lines for names via grep (`staff.ts`, `tenancy.ts`, `customers.ts`, `ratings.ts`);
`packages/contracts/src/bilingual/names.ts` (grep); `packages/contracts/src/customers.ts` lines 73–98 (grep);
`owner-questions.ar.md` lines 1–21, 374–431, 493–502; spec 060 lines 610–620, 740–751 and grep hits for RT-Q*;
`owner-decisions.ar.md` §51 (1197–1218), §56 (1395–1410), §62 (1560–1570), §66 (1624–1636), §67 (1638–1659),
§72 (1779–1798).

**Not read (gaps):**
- G1 `constitution.md`, `PRD.md`, `06_Tech_Stack_Architecture_EN.md` and the full `docs/agent-delivery-pipeline.md`
  were not re-read in this continuation (the pre-compaction part of this task read `AGENTS.md` order but did not finish
  these three; treat as unread).
- G2 ADR-0011 beyond what spec 060 quotes; the commissions engine ADR (ADR-0054) beyond CLAUDE.md's summary.
- G3 API `evaluateAccess`/`protectOwnerAccess` bodies (`protectOwnerAccess` call seen at `access-reader.ts:193`).
- G4 `attendance-change-alert-rule.adapter.ts` (the staff consumer of `readBranchRoleHolders`): its caller requirements
  are NOT verified.
- G5 spec 060 FR-B13, A-1 and the 61-1/61-2 rows outside the lines above; spec refs 323/703–705/781–795/844–856.
- G6 API tenancy `describeWorkspaces`/`businessNames` signatures and whether they return branch names.
- G7 whether the rating-token flow refuses a soft-deleted company.
- G8 `rating_requests` columns (customer link, `business_date`, nullable `branch_id`) — not re-read; F5 carried forward.
- G9 the manager's 8-point decision in its Arabic original: only the brief's English rendering is in context.
- G10 The isolated draft invoked an unverified external JSONB ceiling. The lead removed that assertion; no external
  size ceiling or measured threshold is used in the design argument.
- G11 the governing exception for API identity's direct read of `companies` (`company-active-lock.ts:4–21`) — not
  found; ADR-0037 D2 covers the worker only.
- G12 the lead's byte-table encoder and envelope were not re-run (no shell); the totals were hand-checked against the
  formula only (plan §5.3).

The isolated planner verified the permission FK but inferred P1 → A1 incorrectly. The FK exists
(`packages/db/schema/identity-access.ts:90–92, 191–193`); only E's eventual grant tests depend on its new code.
A1 is docs only. API already depends on `@pospay/i18n`; the chosen details representation uses nullable unsafe/missing
display names and translated individual labels at the renderer boundary, not an arbitrary string in the composer.

**Lead closure of relevant gaps (same pinned source):** the lead previously read all six governance documents,
the full pipeline, spec 060 and ADR-0010; completed both ADR-0037 addenda and the relied-on PP decision bodies in this
continuation. It read `evaluateAccess` and `protectOwnerAccess`, the staff attendance-change adapter, the complete
tenancy `describeWorkspaces` path/signature and the submit path. Source now establishes that the existing submit
does not contain a company-active check and that tenancy metadata returns no deleted company. No exception for a
new identity-to-tenancy table join is borrowed. The commissions-only exceptions remain unused.

The FK does NOT establish P1 → A1: A1 is docs only. The lead withdrew that inference and moved actual reader code/tests
to E; only the eventual real-code permission tests require P1. The lead also verified `normalizePhone`/`maskPhone`
(`customers/domain/phone.ts`), including the existing shorter-phone behavior and contracts' masked `{2,3}` suffix.
That is not a new RT-Q9 exception or a request for owner acceptance.

## E2. Source facts verified this task

### Transport (W)

| ID | Fact | Ref |
|---|---|---|
| F-W1 | `safeText`/`displayName` `.min(1).max(255)` (UTF-16); `displayParameter` strict `{name, type:'text', value}`; IN_APP union of 14 keys; `template_revision: z.literal(1)` | `packages/contracts/src/in-app-notifications.ts` |
| F-W2 | `readInAppNotificationPage` filters unknown keys/higher revisions before parse (client only) | same file |
| F-W3 | `notificationParameter` strict, `value` string ≤ 255 or finite number; `notificationRequest` 1..100 recipients, `business_id`/`branch_id` nullish | `packages/contracts/src/notifications.ts` |
| F-W4 | handler: `LowRatingReceived` is already a source event (line 66); invalid request → `NOTIFICATION_REQUEST_INVALID`; `storeRecipient` → `validInAppTemplate` then store with `safeParameters: recipient.safe_parameters` | worker `on-notification-request.handler.ts` |
| F-W5 | `InAppInput.safeParameters: readonly {name; type:'text'\|'number'; value: string\|number}[]` | worker `domain/in-app-notification.ts` |
| F-W6 | INSERT `${JSON.stringify(input.safeParameters)}::jsonb`, `ON CONFLICT (company_id,source_event_id,recipient_user_id,template_key) DO NOTHING`, then `appendOutboxEvent` with `notificationResult.parse` | worker `drizzle-in-app.repository.ts:12–39` |
| F-W7 | `TemplateParameter.type 'text'\|'number'`, `textKind` six kinds; `SafeParameter`; `UNSAFE_TEXT` (line 28) rejects `\b\d{4,8}\b`; `textAllowed` `value.length > 255 → false` (line 58) | `packages/notifications/src/templates/definition.ts` |
| F-W8 | `validInAppTemplate` fixed list of 14 definitions + exact revision | `generic-notice.ts:36–64` |
| F-W9 | DB: `safe_parameters jsonb NOT NULL`, CHECK `jsonb_typeof = 'array'`, unique `(company_id, source_event_id, recipient_user_id, template_key)`, scope CHECK branch ⇒ business, locale `ar\|en` | `packages/db/schema/notifications.ts:42–67` |
| F-W10 | API inbox selects `safe_parameters` raw and returns `inAppNotificationPage.parse({items, next_cursor})` | `in-app-notifications.query.ts:37–73` |
| F-W11 | renderer: staff alerts use `viewerLocale ?? item.locale`; ar falls back to en; `generic_notice` keeps row locale; unknown keys fall to generic copy | `render-notification.ts:5–52, 182–212` |

### Outbox and deadline (D)

| ID | Fact | Ref |
|---|---|---|
| F-D1 | `appendOutboxEvent` = advisory lock + INSERT (2 statements per event) | `packages/db/src/outbox.ts:36–50` |
| F-D2 | `appendOutboxEvents`: empty → return; dedupe + `localeCompare` sort of aggregate locks; one lock statement; one INSERT…SELECT from `jsonb_to_recordset(JSON.stringify(values))` whose `payload` field is itself a JSON string | `outbox.ts:59–92` |
| F-D3 | `timeoutMs` = one absolute deadline (pool wait, statements, commit); late work never commits; COMMIT sent in time answers for itself; no reply within another `timeoutMs` → `CommitOutcomeUnknownError` | `with-tenant.ts:22–29, 96–137` |
| F-D4 | `beforeCommit` → `refuseIfLate` checks `performance.now() >= endsAt` (clock, not only the timer) | `with-tenant.ts:116–131` |
| F-D5 | `RATING_TRANSACTION_TIMEOUT_MS = 1_000` | `customers.module.ts:42` |

### Rating submit (R)

| ID | Fact | Ref |
|---|---|---|
| F-R1 | use case imports the `submitRatingInput` VALUE from `@pospay/contracts` | `submit-rating.usecase.ts:1` |
| F-R2 | `''` comment → `null`; clock read after `lockRequest`; `TODO(spec): 61-1 appends LowRatingReceived …` | `submit-rating.usecase.ts:51, 65` |
| F-R3 | consume UPDATE `RETURNING id, business_id, branch_id`; ratings INSERT; `SELECT employee_id FROM rating_performers` with NO ORDER BY; per-performer attribution INSERT loop | `drizzle-rating-submission-transactions.ts` |
| F-R4 | `createRatingViewTransactions(db, timeoutMs, names)` injects a port into a persistence factory (precedent for §4) | same file |
| F-R5 | `ratingComment`: >2000 UTF-16 or >1000 code points rejected; control chars except LF/CR/tab rejected; links/markup/bare domains rejected; digit runs are NOT rejected; the synthetic example in plan §3.6 has 19 code points | `rating-comment.ts:187–210, 153–178`; pure character counting, no schema test run |
| F-R6 | `ratings.comment` CHECK `char_length <= 1000` | `packages/db/schema/ratings.ts:238` |

### Identity, settings, staff (I)

| ID | Fact | Ref |
|---|---|---|
| F-I1 | `readAccessTransaction`: `companyIsActive` → memberships with canonical-owner flag → grants (role ALLOW at membership scope, owner salary codes, overrides unexpired) → `protectOwnerAccess`; all per one user | `access-reader.ts:145–204` |
| F-I2 | `readBranchRoleHolders(tx, companyId, businessId, branchId, roles, at)` → `{userId, owner}[]`; empty roles → `[]`; 3-arm scope UNION + canonical-owner query; system roles only; no company-activation check | `branch-role-holders.ts:19` (body read pre-compaction) |
| F-I3 | Legacy API identity `companyIsActive` reads tenancy's company table; this is source evidence, not authority to extend that read | `company-active-lock.ts:4–21`; new design instead uses tenancy public metadata |
| F-I4 | `readAlertRule(tx, companyId, scope, kind)` one query | `settings/persistence/read-alert-rule.ts` |
| F-I5 | worker `readEmployeeDisplayNames(tx, companyId, ids)` → `{employeeId, nameAr, nameEn}`; no `deleted_at` filter; empty → `[]`; no API counterpart found by grep | worker `performer-names.reader.ts` |
| F-I6 | API tenancy `describeWorkspaces(tx, scopes)` → `WorkspaceCompanyNames \| null`, exported via API tenancy index; current tenant read plus scope-tree read; tree selects only `companies.deleted_at IS NULL` and returns the exact business/branch names | `apps/api/src/modules/tenancy/queries/describe-workspaces.query.ts:18–29, 67–91, 110–126`; `tenancy/index.ts:6` |
| F-I7 | Permission editor catalog is DB-driven; custom-role allowedPermissions is null; old grant flow has no future manager-only rule, and old `systemRoleGrantAllowedSql` does not exclude the new code for an owner | API identity `persistence/permission-editor-context.ts:43–46, 87–90`; `domain/permission-edit.ts:155–190`, `permission-eligibility.ts:10–20`; `packages/db/src/system-role-policy.ts:137–151` |

### Name bounds (N)

| ID | Fact | Ref |
|---|---|---|
| F-N1 | employees `char_length(trim(name_en)) 1..255`, `name_ar` NULL or 1..255 | `packages/db/schema/staff.ts:117–120` |
| F-N2 | tenancy names `char_length(name_en) 1..255`, `name_ar` NULL or 1..255 | `packages/db/schema/tenancy.ts:21–24` |
| F-N3 | customers `length(btrim(name)) 1..200`; phone `^[+][1-9][0-9]{1,14}$` (2–15 digits) | `packages/db/schema/customers.ts:43–45` |
| F-N4 | writers: `nameEn`/`nameAr` = `z.string().trim().min(1).max(255)` (UTF-16 ⊂ 255 code points); customer `name` `z.string().min(1).max(200)` (UTF-16 ⊂ 200 code points) | `bilingual/names.ts:4–5`; `customers.ts:90, 98` |

### Boundaries (B)

| ID | Fact | Ref |
|---|---|---|
| F-B1 | elements: `modules/*/<layer>` plus last-match `module-root` (`index.ts`, `<module>.module.ts`) | `boundaries.js:124–137` |
| F-B2 | `module-root` may import every same-module layer | `boundaries.js:159–171` |
| F-B3 | only persistence/http/events reach another module, through its `index.ts` | `boundaries.js:152–155, 178–187` |
| F-B4 | `no-restricted-imports` blocks only `domain/**` (only `@pospay/domain`) and `use-cases/**` (infrastructure, credentials, operator, engine); `@pospay/contracts` is not banned anywhere by lint; packages are not boundary elements | `boundaries.js:190–240` |
| F-B5 | the matrix row for events is `events/handlers/` only; the composition root has no matrix row and is "the only place an interface is bound to a class" | `CLAUDE.architecture.md` §3.1, §5.2 |

## E3. Facts carried forward from the original draft (NOT re-read in this continuation)

F5 `packages/db/schema/ratings.ts:36` `business_date`; F7 `packages/domain/src/alert-rules.ts:4–19, 34`; F8
`settings.ts:105, 152`, `rls-alert-rules.spec.ts:128`; F9 journal idx 216; F10 `access-catalog.ts:11`,
`role-defaults.ts:67`; F14 contracts `alert-rules.ts:103` (max 14); F15 `alert-rules-view.ts:32`; F16
`listed-alert-kinds.ts:4–24`; F20 `rating-comment.ts:171–210` (now re-verified as F-R5); F21 package deps; F22–F24
performer caps (no cap found); F26 API query/admin renderer/schema (now re-verified as F-W9…F-W11); F28
`alert-rules.ts:160–202`. The remaining F1–F28 entries stay as recorded in the original draft.

## E4. Owner records (verbatim)

- RT-Q7b — «الملاحظات بتظهر بس للمالك والمديرين التلاتة، وأي حد تاني معاه الصلاحية بيشوف التقييمات من غير الملاحظات»
  (أبو سالم، صفحة القرارات، الدفعة 40، 22 أكتوبر 2026) — `owner-questions.ar.md:401`.
- RT-Q8 (PP-18.17) — «للمديرين الأربعة (المقترح)» (وليد، عن طريق الـ super agent، 21 أكتوبر 2026) — line 417. Option
  text: «شغّال، جوه التطبيق، للمديرين الأربعة اللي في نطاق فرع الزيارة.»
- RT-Q9 (PP-18.18) — «التفاصيل والملاحظة جوه بس (المقترح)» — line 431. Option text: «عدد النجوم، الفرع، التاريخ، أسماء
  الموظفات، اسم الزبونة وآخر 3 أرقام من تليفونها. والملاحظة تبان جوه التطبيق بس، ولو التنبيه راح واتساب أو إيميل يقول
  «فيه تقييم منخفض، افتح PosPay».» — lines 425–426.
- RT-Q12 (PP-18.20) — «كل الأسماء (المقترح)» — line 502; option text «الأسماء الأولى لكل الموظفات («قيّمي خدمة سارة
  ورنا»)، ولو أكتر من 3: «فريق صالون الأميرة»» (line 497) — context: the customer rating-request message.
- Spec RT-23 (line 614–615): "…performers' first names, the customer's name and last 3 phone digits; the comment only in
  the in-app notice…; never the phone beyond the last 3 digits (S-12), never the token."
- Spec BR-B4 (lines 746–748): comment only for the owner and the three managers holding the ratings-read permission in
  the visit branch scope, "checked at emission; a recipient with a DENY on it gets the same notice without the comment."
- PP-113.1 — «أ⭐ الـ suites التقيلة بتاعة PosPay تتشغّل في الـ CI بس. …ونتيجة الـ CI على نفس الـ head هي اللي تحسم.»
  (`owner-decisions.ar.md:1215`).
- PP-118 — «الحد الأقصى 5 جلسات task شغالة. كل جلسة ماسكة PR واحد بس، وهي اللي توصّله لحد الـ merge حسب PP-117.» (line 1404).
- PP-124 — «قولتلك قبل كدا قرار الدمج معاك ايضا» (line 1568); prod/data/server/secrets/HOLD stay Waleed's (line 1570).
- PP-129 — «#848: DEP-1 ياخد backup جديد قبل ما يطبّق migration على staging بـ«أيوه»» (line 1634).
- PP-130 — «تكديس + فحص CI (مُوصى به)» (line 1653).
- PP-136 — advice is non-binding; PP-n and owner decisions bind (line 1798).

## E5. Review receipts and their scope

| Receipt | Scope | Status |
|---|---|---|
| Review A, task `42da2d20-0c4a-4e87-a550-5d11b6f0e84e` | ORIGINAL draft only (plan SHA-256 `B6B15743BD1B9EB949164D8C7310CAD4F691CA0041454A87FC08DEFC8CCCAA35`, evidence `DA11B3553BEC9FA0326223DCFFF36012A6CFA084F76066127AB89C500D0CDB9C`) | historical; does not approve this version |
| Review B, `gpt-6-astra`/high at `/root/61_1_design` | ORIGINAL draft only | historical; does not approve this version |
| PP-136 advice, task `c6b898df-ac7c-47a6-8b1c-cf261fed0dd1` (claude-fable-5-1) | design input, source analysis only, no benchmark | non-binding; corrections in E6 |
| Fresh independent `gpt-6-astra`/high, `/root/61_1_u_final_review` | plan 551 lines, SHA256 `56D491F0E095E18AFF3F4D4FBDA6D6D8E00D4BF9070CCEB4303251F9C507048C`; evidence 255 lines, `054CC17BA9C40E2FD9B87BF3B2FCCCB12312C6C57EBF62DF9EF2404B89DD7AE9`; unapplied patch 97 lines, `ABAEC211993EF713771F380A0BFDA6E13285579CABE63B70F9A75666B18D47BF` | `REQUIRESCORRECTION`: two P2 documentation findings, fixed by the lead below; not a clean review of the changed hashes |

The original drafts are retained at `F:/Dev/Temp/pospay-61-1-planning/original-reviewed-draft/`.

## E6. PP-136 advice — accepted and corrected

| Advice | Disposition |
|---|---|
| Recommend B (typed object) | Accepted as recommendation; B is recorded as an explicit wire/model change, not "unchanged because JSONB" |
| Bulk `appendOutboxEvents` | Accepted; corrected to "O(1) statements, not O(1) payload/serialization/rows" (F-D2) |
| Set-based identity reader | Accepted as a design: one planned read, with manager eligibility separate from all applicable permission grants/DENY; no query per user |
| Alternative A needs a generic `textKind` | REJECTED: a key-scoped validator bypass suffices |
| Validation in `events/low-rating-notice.ts` | REJECTED: matrix allows only `events/handlers/` (F-B5); root closure instead |
| Advisor reading gaps (ADR-0011 parts, engine ADR, access-reader, ESLint, compose) | access-reader and ESLint now read (F-I1, F-B*); ADR-0011/engine ADR remain gaps (G2); root compose not re-read |

### Lead corrections before the new independent review

- Restored `low_rating_with_comment` to match the exact byte model, removed speculative key-length corrections,
  and required one mixed-ACL list batched only after the disjoint partition. Two keys do not themselves prevent duplicates.
- U3 validator returns parsed strict groups, not a discarded parse result followed by serialization of raw drafts.
  Generic metadata checks do not replace source ownership checks. Domain/ports gain no runtime package dependencies.
- A1 remains documentation only. Future adapters/readers/tests are E work; A1 declares the arrow/ports and comments
  planned exact reads. Active reads land with their adapter, as the current module-map comments require.
- Existing tenancy metadata handles the required tenant/place precondition; no third public company symbol or new
  identity read of tenancy tables. Metadata absence is an explicit proposed enabled-alert availability failure in E,
  not a claim about old submit behavior or a serializable transaction.
- Scalar legacy renderer helpers must be narrowed explicitly when the new details union is added. Runtime parity
  tests belong in worker (existing dependencies), not a new notifications→contracts dependency.
- Root arithmetic includes the bulk values parameter's second JSON encoding. No benchmark, SQL or physical JSONB
  measurement is claimed. P1's old-writer grant compatibility is an additional explicit gate, not automatically passed.
- Source-exact unapplied A1 patch: `F:/Dev/Temp/pospay-61-1-planning/a1-review/a1-proposed.patch`:
  ADR +46/−0, map +11/−2, docs +57/−2; generated `docs/module-map.yaml` projection +1/−1; all categories +58/−3,
  prod/tests 0/0. Virtual before/after files are design artifacts,
  not a checkout; the actual repository ADR/map remain unchanged. The plan's comments defer active reads to E.
- The lead restored the original new-template key to match its exact JSON byte calculation; the three B bulk INSERT
  parameter examples are 10,637 B, 8,999,629 B and 216,445,690 B. These include JSON-in-JSON escaping and entry framing,
  not driver/network/physical storage. No actual SQL was run. Stable request fields were copied from the current source
  contract and field provenance, not inferred from the name `safe_parameters`.

### Fresh review receipt and one consolidated correction batch

The independent reviewer read all six required governance documents in order, the full pipeline/spec060/ADR0010,
ADR0037 with both addenda, the relied-on decision bodies and ADR0011 in full. It disclosed no missing mandatory reading.
It independently confirmed U1/U3 as design, transaction safety versus the explicit unbounded-liveness conflict, the
P1 old-writer counterexample and T-before-E deployment/rollback floor. Synthetic UTF-8 calculations were checked
independently, including the second bulk JSON encoding; no product test, benchmark, SQL, lint or generator was run.

Its two P2 findings were:
1. `module-map.md`'s imports change requires the generated YAML sibling; `scripts/module-map/cli.mjs:24` compares it
   against `renderYaml`. The lead added the expected +1/−1 projection to the unapplied patch and all scope/count tables.
   The actual generated file is unchanged; generation/check remain future authorized A1 gates, not claimed receipts.
2. Membership/branch tests were wrongly applied to all public readers. The lead split them into identity, names and
   place-adapter contracts, including a valid two-branch snapshot names case under D-B3 and deleted staff.

Both were corrected by the owning lead in one documentation-only batch, with source and diff-count read-back.
The final corrected hashes are handed off separately. No second reviewer approval of those changed bytes is claimed,
and no implementation, migration or deployment gate is waived. The A1 proposal is ready for manager review; U2 and
P1 compatibility remain explicit planning gates.

## E7. Guard notes for the A1/T/E implementers (later)

- Do not reuse `displayName` for these fields (F-W1 vs F-N1…F-N4): emoji names legal in the DB can exceed 255 UTF-16.
- Do not import the worker first-name helper or worker identity domain into API code.
- Do not add a new identity join to `companies` or borrow an exception from its legacy `companyIsActive` implementation.
- The new performers read must add `ORDER BY employee_id` (F-R3 has none); id order is part of the details contract.
- `notificationRequest` is `z.object` (non-strict at the top): the composer must not rely on it to strip keys.
- The comment group's outbox payload holds the comment and customer name; outbox retention applies unchanged.

## E8. Scope boundary and historical planning status

The earlier source-only planning phase ran no gate or generator and edited no actual ADR/map/YAML. The new A1
authorization in §E0.1 changes only that documentation status: ADR/map markdown is applied and YAML generated.
There is still no runtime code, executable test, SQL/migration, seed, benchmark, activation, deploy, config/secret
change or new owner question. #887 and #803–#811 remain untouched/open, and #888's worktree/backups are retained.
A1 check/review/commit/PR receipts belong to the new delivery and are recorded separately; old receipts do not pass it.

## E9. Line count of this planning change

Both files are new against the baseline; all their lines count as docs, added. Prod 0, tests 0,
generated 0, deleted 0. The isolated planner delivered 457 + 194 = 651 lines; the lead's later corrections and Arabic
audit add to that count. Final line totals and artifact hashes are recorded in the handoff after integration.
The latest manager approved a 1000-line A1 brief including every +/− category and generated output, rejection above
2000 and three correction rounds. No future production step is approved. Current A1 includes both documents plus
ADR/map/YAML; its actual all-category size is measured from the final Git diff after the documentation updates.

## E10. A1 delivery checks (live base)

- Base/context/checkpoint and successful `module-map:generate`: §E0.1.
- `module-map:check`: exit 0, `module map: ok` (background completion received).
- `lint:docs`: exit 0 after P1 integration, 0 errors and 29 existing TODO/brand warnings.
- Strict UTF-8 decode of all five files and explicit Arabic manager-decision read-back passed; no U+FFFD found.
- Staged `git diff --check` passed. Scoped Prettier exited 0, subject to the exclusions below.
- Repository `.prettierignore` excludes `docs` and `*.md`; a successful normal Prettier invocation cannot be claimed
  as Markdown-format coverage. Keep that exclusion unchanged; check the changed text/whitespace explicitly.
- Fresh independent review of the actual five-file A1 diff on the live base: pending. The previous planning review
  was `REQUIRESCORRECTION`; its corrected findings are not reused as a PASS of this delivery.
- The immutable delivery head, measured size and fresh review receipt will be reported in the A1 PR and handoff;
  a pending marker here is the truthful pre-review checkpoint, not permission to open a PR without review.
- A1 correction budget: initial delivery, no correction push yet; cap three. Prior #888 budgets/exception history
  remain preserved and are not reset by this separate documentation assignment.

## E11. P1 writer/guard planning follow-up (no execution)

PP-136 advice and the Opus planner fragment changed §7.2: default insertion is the grantability boundary, custom-role
targets are the old-writer counterexample, and safe REVOKE requires read-time eligibility without blocking cleanup.
G then S is a PROPOSAL requiring manager acceptance, not an approved additional PR or permission window. G must not
seed the new code early. No migration number is reserved. All DEP-1 live-writer evidence remains UNKNOWN.
Lead verified full grant/revoke use cases, `permissionEditFailure`, `systemRolePolicy`/override SQL, access-reader grants
and seed catalog/default functions; earlier source investigation covered onboarding, operator and controller wiring.
Historical migration write-line searches classify privileged catalog/default writers, not an audit of all SQL bodies.
The latest planner read 0201 fully, not every historical migration or every override reader; reader inventory remains
a G prerequisite. Its incomplete governing-file reading is not final approval. Fresh A1 review is separate (§E10).
No live custom-role count, runtime container inventory, SQL execution, seed, source edit or deployment was performed.
