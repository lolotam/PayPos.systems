# سجل قرارات المالك — #836 ودفعة 2026-11-10

## الموافقات القائمة

التاريخ: 2026-11-10. القناة: محادثة المشروع مع Waleed.

نص موافقة المالك كما ورد، دون تعديل:

> Approved for this batch:
> 1. Authorize Sol for planning and Astra for advisory in place of the denied Opus/Fable lanes.
> 2. Launch the four implementation tasks (#836 with provisional 0217, #802, #900, #774) in isolated worktrees/DBs with zero shared-file edits.
> 3. Treat #857 as verification-only against merged #873 (explicitly verify trailing-slash handling in AUTH_TRUSTED_ORIGINS entries as well; only report if a real gap remains).

هذا الاستثناء خاص بهذه الدفعة فقط. لا يغيّر بوابات الجودة أو يصرّح بتعديل الإنتاج أو الأسرار أو الخادم. رقم 0217 مؤقت حتى الدمج.

## I836-Q1 — ملكية سجل migration المشترك

الحالة: **APPROVED** — 2026-11-10، أداة السؤال داخل محادثة المشروع.

السؤال: تشغيل migration الجديدة يتطلب تحديث `packages/db/migrations/meta/_journal.json`. هل تسمح بأن يملك مدير الدفعة هذا التحديث حصرياً ضمن PR #836، مع منع العمال الثلاثة الآخرين من تعديل هذا الملف؟

1. **المقترح:** السماح للمدير بتحديث سجل migration والملفات المولّدة التابعة لـ #836 حصرياً، بعد مراجعة schema والاختبارات. لا يحرره عامل #836 ولا أي مهمة أخرى بالتوازي.
2. إبقاء الحظر حرفياً؛ يستمر عمل schema والاختبارات في #836، وتتوقف خطوة توليد وتسجيل migration حتى قرار لاحق.

السبب: تشغيل migration يعتمد على سجل الاكتشاف؛ إضافة SQL وحدها لا تنتج migration قابلة للتشغيل. استشارة Astra فصلت هذه النقطة عن بقية حدود الملفات المستقلة.

نص السؤال المعروض فعلياً كما ورد:

> Migration #836 cannot run without updating packages/db/migrations/meta/_journal.json. May I exclusively own its journal/generated-metadata update within #836’s PR, while all four implementation workers remain forbidden from editing that file? Schema/test work and the other three tasks continue meanwhile.

إجابة Waleed كما وردت، دون تعديل:

> Approve manager-only update

القرار: يملك مدير الدفعة توليد وتكامل سجل migration والملفات المولّدة التابعة لـ #836 حصرياً داخل PR المهمة. يظل تعديل السجل ممنوعاً على عمال التنفيذ الأربعة؛ لا يوجد تحرير متزامن أو صلاحية لمهمة أخرى. تبقى اختبارات RED ومراجعة schema قبل التوليد مطلوبة، ويظل رقم 0217 مؤقتاً حتى الدمج.
