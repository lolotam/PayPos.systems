# أسئلة المالك — إصلاح حواجز CI

التاريخ: 2026-11-10. القناة: محادثة المشروع، أداة السؤال. سؤال تقني؛ لا يُنشر على صفحة قرارات الشريك.

## CI-Q1 — توسيع النطاق المعزول

السؤال الحرفي:

> All four PRs are CI-blocked by worker performance failures; #911 also hit an admin race. Authorize separate CI-repair worktrees/PRs, one task at a time in the fifth slot, using Sol medium implementation and Astra advisory, without relaxing thresholds or mixing edits into the four current PRs?

الخيارات الحرفية:

1. `Approve repair (Recommended)` — Diagnose and repair each blocker in its own isolated PR; retain every quality gate.
2. `Keep blocked` — Leave all four draft PRs unchanged; start no additional repair work.

التوصية: الخيار الأول. إجابة المالك الحرفية:

> Approve repair (Recommended)

التطبيق: إصلاح أداء worker أولاً في worktree وPR مستقلين؛ إصلاح سباق admin في مهمة لاحقة بعد خلو الخانة الخامسة. لا تعديل على PRs #910/#911/#912/#913، ولا تخفيف حد أو assertion أو fixture. لا تفويض نشر أو تعديل خادم أو بيانات إنتاجية أو أسرار. مسار التفويض المدمج فقط؛ لا CLI بديل.

يبقى استثناء التخطيط Sol والمشورة Astra المعتمد للدفعة مرجع الأدوار لهذه المتابعة؛ لا استبدال نموذج غير مُعلن. السجل الأصلي للدفعة محفوظ خارج المستودع في `F:/Dev/Temp/opencode/pospay-batch-20261110/batch-receipt.md`.

## CI-Q2 — Redis محلي مؤقت للمهمة فقط

السؤال الحرفي:

> Authorize one disposable local Redis 7 container dedicated to this repair, with a loopback-only port, independently generated test credentials and no persistent volume, for focused correctness tests only? The performance suite stays CI-only; shared Redis and the four existing task environments remain off-limits.

الخيارات الحرفية:

1. `Approve private Redis` — Run focused correctness tests against a new task-owned local container; no production/server changes or performance-gate execution.
2. `CI verification only` — Create no local Redis; report local runtime verification unavailable and obtain correctness/performance evidence only through draft CI.

التوصية: الخيار الأول، لتشغيل اختبارات الصحة على Redis الحقيقي قبل نشر PR. الـharness الحالي يستخدم fallback مشترك عند غياب REDIS_URL؛ لن نشغّله بهذه الصورة ولن نعدّل إعداده المشترك.

إجابة المالك الحرفية عبر أداة السؤال في 2026-11-10:

> Approve private Redis

التطبيق: container محلي مؤقت واحد ببادئة وlabels للمهمة، منفذ loopback فقط وبيانات اختبار مولدة بصورة مستقلة، بلا volume دائم. اختبارات الصحة المحدودة فقط محلياً؛ مجموعة الأداء تبقى CI-only ولا تُجبر بواسطة CI=true. لا اتصال Redis مشترك أو تغيير خادم أو بيانات إنتاجية أو بيئة أي مهمة أخرى.
