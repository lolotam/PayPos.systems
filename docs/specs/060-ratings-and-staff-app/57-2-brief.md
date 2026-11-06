# 57-2 replacement delivery brief and isolation audit

## Owner isolation decision — 2026-11-07

**البطاقة حرفيًا:**

> قرار عزل 57-2 — التفويض فشل لأن مجلد الجلسة القديمة بلا .git. فحصت جلستي أيضًا: HEAD قديم وفيها تعديلات محفوظة، فلا تصلح كبداية حديثة. هل تسمح بإنشاء جلسة T3 عليا بديلة واحدة عبر t3_thread_launch، بـworktree من origin/main المتحقق منه وفرع feat/57-2-my-work-api؟ تستبدل جلسة 57-2 الحالية في العدّ؛ القديمة تحفظ عملها وتتوقف عن التنفيذ، فلا نضيف مهمة سادسة. أول مرحلة تحقق قراءة فقط من المسار والفرع وHEAD؛ بعدها يبدأ النطاق المعتمد، بلا نقل أسرار أو لمس العمل القديم. يلزم إذنك لأن تعليمات T3 تشترط طلبك الصريح لإنشاء جلسة عليا جديدة.

**الخيارات حرفيًا:**

1. «أوافق على جلسة بديلة واحدة لـ57-2 (الموصى به)»
2. «أوقف 57-2 مؤقتًا مع حفظ الخطة»

**الجواب حرفيًا:** «أوافق على جلسة بديلة واحدة لـ57-2 (الموصى به)».

Source: owner's replacement-session instruction, followed by workspace approval message
`ebd95c67-f5ef-43b1-a3f7-b9cef511de6d`. This session owns implementation, checks and delivery;
the former session stopped dispatch and implementation. Its worktree and backups remain untouched.

## Verified workspace receipt before source edits

- Top level: `C:/Users/waleed_Mohamed/.t3/worktrees/main/feat-57-2-my-work-api`.
- Branch: `feat/57-2-my-work-api`.
- HEAD and local `origin/main`: `da775eb5e5b62adcb48b26d1e55fdba1a2ce671f`.
- `git status --short`: empty. Receipt sent to the manager before source edits.
- Environment inventory: only `.env.example`, tracked, not ignored; owner
  `DESKTOP-U5N57Q2\waleed_Mohamed`. No environment values read or copied. No `.env` exists.
- Identity approved directly by the manager; no second approval required.

## Binding delivery scope

The approved revision-2 plan, especially §11, is copied alongside this brief.
Implementer: Codex `gpt-6.1-sol`, medium, standard, in this session. No duplicate implementer.
Fresh independent Astra high review follows implementation and local gates, before the single PR.

D1: new provider-owned staff/identity public readers on the caller's transaction and clock.
D2: own integer `share_bps`. D3: hidden tips return only month/status and issue no tip query.
Q1: `late` follows `date`. Q2: injected domain callback for tip totals. Q3: device branch proves
authority without narrowing history. Q4: `line_id` cursor with server lookup and uniform 400.
Q5: D-A7 context identifiers/cancellation timestamp remain, documented without another timestamp.
Q6: one PR, expected 2,800 changed lines; refuse above 5,600, counting all additions and deletions
in production, tests, docs and generated artifacts.

Measure tip query, materialisation and aggregation time and memory; no silent limit.
Cover historical/inactive branches, transfer, cancelled cursor anchor, removal, ties, tenant
isolation and column projection. No migration, UI, native, workflows, `leave.ts`, 68 history,
57b-1 changes or 42 package-sale production. Shared module/exports additions only; regenerate
OpenAPI/clients on the merge base. Merge waits for the manager's turn, all gates and verified
applicable backup/restore. No deployment authorized. Three correction rounds; four panel
receipts before a consolidated correction push; Codex once on the final head.

Historical handoff read from `F:/Dev/Worktrees/PosPay/briefs/57-2/handoff-57-2.md`.
Its obsolete phase-one wait does not override the owner's approved workspace receipt.
