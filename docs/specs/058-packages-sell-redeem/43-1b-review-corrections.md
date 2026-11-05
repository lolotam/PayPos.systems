# 43-1b review correction batch

Independent Codex `gpt-6-astra`, high, reviewed head
`3bbbe74f33baf1cedd45be6c369cb4fac899e52e` against
`0b27b2364bd153e236018883a704cbd9ebad597e` from immutable Git objects.
Result: REQUEST_CHANGES, one P2; no confirmed P0/P1. Full governing and relevant
spec/owner/plan reads were completed with every truncation repaired. No tests
were independently executed. Task receipt:
`node:delegated-task:command%3Amcp%3A837bda50-0114-4922-8d73-ac3cf991dfc3%3Adelegate-task%3A6142a9a5-622c-450c-8c2f-d53a6d179177`.

The marker refusal reused `SESSION_LINE_NOT_EDITABLE`, whose Arabic and English
translations claimed the line was cancelled even for an ACTIVE redeemed line.
FR-034, RC-06 and the error catalog explicitly require **422
`SESSION_LINE_PRICE_NOT_EDITABLE`**, with «سعر جلسة الباقة ثابت.» / "A package
session's price cannot be edited." There is no ambiguity. The correction uses
that dedicated domain code and explicit HTTP mapping instead of generalizing the
legacy cancellation code. This also fixes Astra's misleading-message P2 while
preserving the original cancelled-line code and messages. HTTP assertions prove
the exact bilingual response and unchanged status/revision for ACTIVE redeemed
and CANCELLED paid lines.

All four panel findings are included: direct domain tests for redeemed active,
stale and cancelled cases plus explicit null acceptance (`r4475173202`); exact
spec code/message/status (`r4475173211`); Arabic fixture comment (`r4475173215`);
updated cancellation/performer JSDoc describing marker-derived facts and slice44
activation (`r4475173220`). Plan and implementation receipt use the exact code.

Focused verification: **12 private PG16 integration tests passed, 45.68 seconds**;
**19 domain tests passed, 974ms**; **27 filter tests passed, 17.60 seconds**;
**8 i18n tests passed, 1.27 seconds**. The first HTTP assertion run correctly
failed because the draft asserted 409; the existing refusal is 422 and the final
test now asserts the spec's 422. No failure was waived. Focused ESLint passed.

The storage PP-123 correction at `c90951d8` was merged into this local branch so
the private tests use actual 0205/0206 online migrations. This storage dependency
update and the translation/test change will be included in #839's own single
consolidated correction push after all its required receipts finish. Codex's
receipt on `3bbbe74f` completed without findings; all four panel bots completed
on that head with these four findings. This is #839's correction push 1; session
review/fix counter advances from 2/5 to **3/5** when published, never reset.

The earlier local receipt's statement about waiting for storage merge is
historical. The manager explicitly authorized #839 opening before storage merge,
with base #838's branch; the manager will retarget before deleting that branch.
No merge, deployment or manual MergePilot/Opus request is authorized.
