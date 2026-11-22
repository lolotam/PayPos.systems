# Browser geometry review — 074-3 + 074-8

**Method / الطريقة.** An isolated static harness outside the repository (`F:\Dev\Temp\opencode\pospay-074-38-browser`): a Vite build that imports `@pospay/ui` sources from this worktree through resolve aliases, loads `packages/ui/src/styles/theme.css` with `@tailwindcss/vite`, and renders the seven parts and the three templates with fixture text only. It simulates the live admin frame (`md:ms-72` sidebar of 288px, `ps-8 pe-8 py-8` main) so the 1024px measurement is realistic. The harness shares no file with the 074-4/5/6 fixture and no CI job; it is a recorded manual review by the owning session, as the plan's verification table requires for the page-level stories. Direction is switched per run with `?dir=rtl|ltr`; widths are real viewport sizes set in the browser.

**حarness جاهز مستقل خارج المستودع يبني الكيت من مصدره ويحاكي إطار اللوحة الحقيقي؛ الاتجاهات والمقاسات حقيقية من المتصفح.**

**Known limitation / حدود معروفة (مسجّلة عمدًا):** the three templates in the harness carry synthetic fixture data mirroring the real markup, so this review measures the shared parts and the template geometry — the three live pages' own mobile rendering and the real logo upload panel inside the 1024px column are re-checked in the 074-7 release's full three-width pass (`pr-sequence.md` assigns page checks at three widths to 074-7). **القياسات هنا لأجزاء الكيت وهندسة القوالب ببيانات تجريبية مطابقة للتركيب الحقيقي؛ فحص الصفحات الثلاث الحقيقية على الموبايل ولوحة الشعار الفعلية يعيدونه خطوة 074-7 على ثلاثة مقاسات.**

## Measured results (Playwright, exact head of this PR)

| Check | 1280 | 1024 | 820 | 390 |
|---|---|---|---|---|
| No page scrolls sideways (RTL + LTR) | ✓ | ✓ | ✓ | ✓ |
| List `PageShell` width ≤ 1200px, centred | 913 (container-bounded) | 657 | 453 | 311 |
| Form `PageShell` width ≤ 840px, centred | 840 | 657 | 453 | 311 |
| Two-column arrangement | grid 2fr/1fr (593/296) | grid 2fr/1fr (422/211) | stacked, main first (453) | stacked, main first (311) |
| Logo (side) card and its controls | 296px | **211px — buttons fit** | full width | full width |
| Tab row / tab item height | 48px | 48px | 48px | 48px |
| Pill item height | 44px | 44px | 44px | 44px |
| Bottom bar height / five cells | 64px | 64px | 64px | 64px |
| Table under 600px | table | table | table | **stacked cards (`display: block`)** |
| Long Arabic label cut with ellipsis, never widens the row | ✓ | ✓ | ✓ | ✓ |
| Kit part isolation (current item, count chip, Soon mark) | ✓ | ✓ | ✓ | ✓ |

A defect was found and fixed during this review: the shared link class's `whitespace-nowrap` let a long label overflow its list item and inflate the page width in RTL at 1024px and 390px. The fix (`min-w-0 max-w-full` on the link, `min-w-0` on the truncating spans, and a card class without the nowrap for `HubCard`) is part of this PR; the table above is measured after the fix. The one gap in the table: the bottom bar's height in the RTL runs was read with an LTR `aria-label` probe and reported null; the bar is the same component in both directions and measures 64px in LTR — visible in `rtl-*.png` as well.

**النتيجة:** كل المقاسات المطلوبة صحيحة في الاتجاهين بعد إصلاح قصّ التسمية الطويلة؛ الشعار يتسع في عموده الضيق عند 1024px.

## Screenshots

`rtl-1280.png`, `rtl-1024.png`, `rtl-820.png`, `rtl-390.png`, `ltr-1280.png`, `ltr-1024.png`, `ltr-820.png`, `ltr-390.png` — full-page captures of the same fixture at each width and direction, showing the kit parts, the list template, the 840px form, the two-column template and the 64px bottom bar.

## Round 2 refresh (fixture evidence, code at `0ead2ba85`)

This section is **fixture evidence**: the same isolated harness, rebuilt from the kit source after the review round 2 fixes, with one added table row whose name is 255 unbroken characters and with the workspace switcher's new `switcher` label. It does not replace the signed-in pass on the three live pages, which is tracked for the 074-7 release checklist in issue #1192 (including the real logo panel at 1024px).

**إثبات على الـ fixture فقط بعد تصليحات الجولة الثانية؛ فحص الصفحات الثلاث الحقيقية بعد تسجيل الدخول متابَع في #1192 ضمن قائمة إصدار 074-7.**

| Check (Playwright, RTL and LTR) | 1280 | 1024 | 820 | 390 |
|---|---|---|---|---|
| Page scrolls sideways | no | no | no | no |
| 255-character unbroken name | table scrolls inside its own frame | same | same | **wraps inside the stacked card, no sideways scroll** |
| Stacked header | shown | shown | shown | visually hidden, still in the accessibility tree |
| Bottom bar height with icon, label and Soon mark on one line | 64px | 64px | 64px | 64px, no cell overflow |
| Smallest nav link (width × height) | 81×44 RTL, 87×44 LTR | same | same | 65×44 |
| Page header description inside the shell | one line | one line | one line | one line with an ellipsis |

The eight screenshots above were replaced with captures from this refresh.
