# 00 · Local setup — تشغيل النظام على جهازك

**Status / الحالة:** needed by every other journey until the apps are deployed to staging.

## العربي

1. شغّل قاعدة البيانات و Redis: `pnpm infra:up`.
2. طبّق تغييرات قاعدة البيانات: `pnpm db:migrate`.
3. في ملف `.env` خلّي كل العناوين على نفس الاسم `localhost` (عشان الـ cookie تشتغل بين الـ API واللوحة):
   - `BETTER_AUTH_URL=http://localhost:3000`
   - `NEXT_PUBLIC_API_URL=http://localhost:3000`
   - `VITE_API_URL=http://localhost:3000`
   - `AUTH_TRUSTED_ORIGINS=http://localhost:3001,http://localhost:5173`
4. شغّل الـ API: `pnpm --filter @pospay/api build` ثم `pnpm --filter @pospay/api start` (على البورت 3000).
5. شغّل الـ worker بنفس الطريقة: `pnpm --filter @pospay/worker build` ثم `pnpm --filter @pospay/worker start`.
6. شغّل لوحة الإدارة على 3001: `pnpm --filter @pospay/admin dev -- --port 3001` ← افتح `http://localhost:3001`.
7. شغّل تطبيق الكاشير: `pnpm --filter @pospay/pos dev` ← افتح `http://localhost:5173`.
8. **بيانات تجريبية:** لسه مفيش سكريبت بيعمل شركة تجريبية كاملة. لحد ما يتعمل، اطلب من Claude يجهّزلك:
   مستخدم مالك بإيميل وباسورد، شركة، نشاط، فرع، وعضوية المالك فيها.

## English

1. Start Postgres and Redis: `pnpm infra:up`.
2. Apply migrations: `pnpm db:migrate`.
3. In `.env`, use the same host name `localhost` everywhere so the session cookie works between the API and the apps:
   `BETTER_AUTH_URL=http://localhost:3000`, `NEXT_PUBLIC_API_URL=http://localhost:3000`,
   `VITE_API_URL=http://localhost:3000`, `AUTH_TRUSTED_ORIGINS=http://localhost:3001,http://localhost:5173`.
4. API on port 3000: `pnpm --filter @pospay/api build`, then `pnpm --filter @pospay/api start`.
5. Worker: `pnpm --filter @pospay/worker build`, then `pnpm --filter @pospay/worker start`.
6. Admin on 3001: `pnpm --filter @pospay/admin dev -- --port 3001` → `http://localhost:3001`.
7. POS: `pnpm --filter @pospay/pos dev` → `http://localhost:5173`.
8. **Demo data:** there is no full demo-tenant script yet. Until there is, ask Claude to prepare an owner user
   (email + password), a company, a business, a branch and the owner's membership.

## For an agent

- Dev servers are long-running: start them in the background and stop them when the journey ends.
- Health: `GET http://localhost:3000/ready` must answer 200 before any journey starts.
