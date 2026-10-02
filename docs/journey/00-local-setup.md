# 00 · Local setup — تشغيل النظام على جهازك

**Status / الحالة:** needed by every other journey until the apps are deployed to staging.

## العربي

1. **جهّز ملف `.env` الأول** في جذر المشروع من `.env.example`: املأ باسوردات وعناوين قاعدة البيانات و Redis،
   و `BETTER_AUTH_SECRET`، وخلّي `NODE_ENV=development` و `COOKIE_DOMAIN` فاضي.
   خلّي كل العناوين على نفس الاسم `localhost` عشان الـ cookie تشتغل بين الـ API والتطبيقات:
   - `BETTER_AUTH_URL=http://localhost:3000`
   - `NEXT_PUBLIC_API_URL=http://localhost:3000` و `VITE_API_URL=http://localhost:3000`
   - `AUTH_TRUSTED_ORIGINS=http://localhost:3001,http://localhost:5173`
   - `WORKER_PORT=3002` (البورت 3001 للوحة الإدارة)
2. شغّل قاعدة البيانات و Redis: `pnpm infra:up` ← ثم `pnpm db:migrate`.
3. ابنِ الـ API والـ worker مع الحزم اللي بيعتمدوا عليها:
   `pnpm exec turbo run build --filter=@pospay/api --filter=@pospay/worker`
4. شغّل الـ API (بورت 3000): `pnpm --filter @pospay/api start` — والـ worker (بورت 3002): `pnpm --filter @pospay/worker start`.
5. لوحة الإدارة على 3001: `pnpm --filter @pospay/admin dev --port 3001` ← افتح `http://localhost:3001`.
6. تطبيق الكاشير: `pnpm --filter @pospay/pos dev` ← افتح `http://localhost:5173`.
7. **بيانات تجريبية:** `pnpm --filter @pospay/api demo:seed` بيعمل مستخدم مشغّل المنصة وعضويات مالك وشركات
   وأنشطة وفروع تجريبية. باسورد المستخدم ده عشوائي ومش بيظهر، فاطلب من Claude يجهّزلك حساب تجربة بإيميل
   وباسورد معروفين وعضوية في الشركة التجريبية.

## English

1. **Prepare the root `.env` first** from `.env.example`: database and Redis credentials and URLs,
   `BETTER_AUTH_SECRET`, `NODE_ENV=development`, `COOKIE_DOMAIN` empty. Use the same host `localhost` everywhere:
   `BETTER_AUTH_URL=http://localhost:3000`, `NEXT_PUBLIC_API_URL=http://localhost:3000`,
   `VITE_API_URL=http://localhost:3000`, `AUTH_TRUSTED_ORIGINS=http://localhost:3001,http://localhost:5173`,
   and `WORKER_PORT=3002` (3001 is the admin app).
2. Start Postgres and Redis: `pnpm infra:up`, then `pnpm db:migrate`.
3. Build the API, the worker and their dependencies: `pnpm exec turbo run build --filter=@pospay/api --filter=@pospay/worker`.
4. Start the API (3000): `pnpm --filter @pospay/api start`; the worker (3002): `pnpm --filter @pospay/worker start`.
5. Admin on 3001: `pnpm --filter @pospay/admin dev --port 3001` → `http://localhost:3001`.
6. POS: `pnpm --filter @pospay/pos dev` → `http://localhost:5173`.
7. **Demo data:** `pnpm --filter @pospay/api demo:seed` creates a demo platform operator, owner memberships,
   companies, businesses and branches. The operator's password is random and never printed, so ask Claude to
   prepare a test account with a known email and password and a membership in a demo company.

## For an agent

- Dev servers are long-running: start them in the background and stop them when the journey ends.
- Health: `GET http://localhost:3000/ready` and `GET http://localhost:3002/ready` must answer 200 first.
