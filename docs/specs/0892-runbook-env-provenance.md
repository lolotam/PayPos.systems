# #892: local test environment provenance

This execution reference records the manager's no-copy and isolation directions,
as supplied in the corrected task brief. It does not authorize a runtime loader
redesign, Docker/DB execution, migrations or Redis provisioning for #892.

## Source and attribution

The source is task session **59b-2b**, not the manager's own timeline:

- `sourceThreadId`: `mcp:launch:7cb4fa9bf05715d61e34f90d8cf874e5e170da2d320c34b58c525c91475a0f76`
- `senderThreadId` (manager): `dfb4c927-5b17-4231-b0c8-34274c1edb05`
- Date: **2026-11-02**, Kuwait (`UTC+03:00`).
- Original receipts retained outside source under
  `F:/Dev/Worktrees/PosPay/briefs/replacements-after-897-20261107/`:
  `no-copy-provenance.ar.md` and `no-copy-original-items.json`.

### Position 818 — 14:53:16 Kuwait

`updatedAt`: `2026-11-02T11:53:16.776Z`.

`itemId`: `turn-item:message:message%3Amcp%3Af69d6e49-2b94-44f5-874f-27c9f48c1346%3Athread-send%3Ae51f02b0-ab99-4184-bf53-b365c03cdd56`

> لا worktree shell جديد؛ أي baseline موجود يُدار عبر T3، ولكل worktree قاعدة اختباره الخاصة؛ لا نسخ env إلى checkout آخر أو مشاركة lane بين worktrees.

### Position 834 — 14:58:54 Kuwait

`updatedAt`: `2026-11-02T11:58:54.762Z`.

`itemId`: `turn-item:message:message%3Amcp%3Af69d6e49-2b94-44f5-874f-27c9f48c1346%3Athread-send%3A5886fe20-5cfa-4ee7-9b26-fa441fe5bfeb`

> إعدادات DB تخص نفس worktree فقط، عبر helper/إعداد مهمتك الآمن، بلا نسخ أسرار من مهمة أو checkout آخر ولا طباعة قيمها.

### Position 845 — 15:07:59 Kuwait

`updatedAt`: `2026-11-02T12:07:59.590Z`.

`itemId`: `turn-item:message:message%3Amcp%3Af69d6e49-2b94-44f5-874f-27c9f48c1346%3Athread-send%3Ada86b4ac-b769-4b45-8aa4-b697395a8e12`

The corrected brief supplies this excerpt (ellipses retained):

> أنشئ .env محلية من .env.example في worktree هذه فقط، وولّد POSTGRES_* المطلوبة محلياً بـ crypto.randomBytes دون طباعة أو commit أو نسخ من checkout آخر... docker compose config يتحقق أيضاً من REDIS_PASSWORD لأن الملف يصف Redis؛ يجوز توليد قيمة محلية عشوائية لهذا المتغير من أجل حل config فقط. هذا ليس تصريحاً بتشغيل Redis جديدة ولا تجربة هذه القيمة على Redis المشتركة... النص القديم في runbook يُسجَّل كعدم اتساق توثيقي للمتابعة، ولا تُعدّله ضمن R5 المقفلة.

## Application in #892

The old runbook copy instruction was deferred from the closed R5 scope; #892 now
authorizes correcting it. Prepare only worktree-local generated values in its ignored
`.env`, using the tracked `.env.example` template. Never transfer secrets between
checkouts, print them or commit them. Each worktree owns its Postgres test cluster.
The helper's generated `.env.test.local` contains only the host/port override.
Redis config interpolation grants no permission to start Redis or use shared Redis;
a Redis-dependent test waits for an explicitly authorized isolated setup.
