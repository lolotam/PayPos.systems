# First-owner rehearsal on staging — procedure (2026-11-23)

Purpose: prove, on staging, the exact path that will create the salon's company and its owner on production, and
find what is missing before go-live. Owner answer P3 (Waleed, 2026-11-23): «صاحب الصالون نفسه» — the salon owner's own
account creates the company, so the owner row is theirs from the start.

Who runs it: the manager (DEP-1), with a test email address that is not a real customer's. Steps on the server are
one-shot containers on staging only, reached the way every staging deploy step is; nothing here touches production.
Never paste a link, token, password or database URL into a thread, a PR or a file.

Read against `origin/main@dc5b78786`. Commands marked **(to confirm)** were derived from the code, not run.

## What the code says the path is

1. `platform:create-user` creates a user with a random password as `pospay_auth` and prints a one-time link, valid
   one hour, printed once (`packages/auth/scripts/create-user.ts:9,66-68`; `packages/auth/src/create-platform-user.ts:55-58`).
   Public sign-up is off (`packages/auth/src/config.ts:243`, `disableSignUp: true`).
2. The link is `<api>/v1/auth/reset-password/<token>?callbackURL=<admin origin>/set-password`
   (`packages/auth/src/config.ts:50,214`; `create-user.ts:35`).
3. `platform:grant --permission create:companies:platform` runs as the migration owner
   (`packages/db/scripts/platform-grant.ts:9-10`), with `--expires` and `--revoke`.
4. `POST /v1/companies` needs that grant and an `Idempotency-Key`
   (`apps/api/src/modules/identity/http/companies.controller.ts:19-23`); the body is `name_en`, optional `name_ar`,
   and `plan_id` (`packages/contracts/src/tenancy/company.ts`, `createCompanyInput`).
5. The caller becomes the first owner, inside `withNewTenant`
   (`apps/api/src/modules/identity/use-cases/onboard-company/onboard-company.ts:9`,
   `persistence/onboarding-transactions.ts:43`).
6. `plan_id` must exist. The only plan row is inserted by the seed, with a fixed id
   (`packages/db/src/seed.ts:33,47-50`); the migrate step does not run the seed (`deploy/Dockerfile.api:21`).

## Known gaps before starting

| # | Gap | Evidence | Smallest fix |
|---|---|---|---|
| G1 | No admin page at `/set-password` | `apps/admin/app/` holds `login`, `security`, `(dashboard)` only | **PR-D** (brief in `briefs/2026-11-23-prod/`) |
| G2 | No admin screen calls `POST /v1/companies` | no reference to `v1/companies` under `apps/admin` | **PR-H**: a "create company" form for a signed-in user holding the grant (about 180 lines). Without it step 8 is a browser-console call, acceptable only with the manager present |
| G3 | A fresh database has no plan row | point 6 above | the `seed` one-shot service in PR-A |
| G4 | No image could run `platform:create-user` (the script lives in `packages/auth/scripts/`; `migrate` is built from `packages/db` only) | `deploy/Dockerfile.api` before PR-E | **Closed by PR-E**: the `ops` target, published as `ghcr.io/lolotam/pospay-ops:<sha>`, holds `scripts/create-user.ts` (`@pospay/auth`) and, under `db/`, `platform-grant.ts`, `seed.ts` and `platform-commission-approval.ts` (`@pospay/db`). Step 1 only checks it |

## Procedure

**0. Prepare.** Note the staging SHA that is live. Pick a test email (`owner-rehearsal+<date>@…` on a domain Waleed
controls). Have the staging admin and API hosts at hand.

**Loading variables (steps 2, 3 and 7).** The `--env NAME` commands below assume the variable is already in your shell
or in a mode-600 temporary `--env-file` that you delete after the run. Build each `*_DATABASE_URL` from its password with
`read -rs` (never on the command line), as `docs/runbook.md` «First-owner operator scripts» shows. On staging the
network is `--network dokploy-network`; in production it is `--network pospay-prod-internal`.

**1. Check the operator image (G4, closed by PR-E).** On the server, read-only; `<sha>` is a SHA published after PR-E merged:

```sh
docker run --rm ghcr.io/lolotam/pospay-ops:<sha> sh -c 'ls scripts db/scripts'
```

Expected: `create-user.ts` under `scripts`; `platform-grant.ts`, `seed.ts` and `platform-commission-approval.ts` under `db/scripts`. If the image does not exist, the SHA predates PR-E: stop and pick a newer one. Do not copy files into a container by hand.

**2. Reference data (this step writes).** It re-applies the plan row and the access catalog on staging; skip it if
a read-only `SELECT id FROM plans` as the migration owner already returns the provisional plan:

```sh
docker run --rm --network dokploy-network --env MIGRATION_DATABASE_URL ghcr.io/lolotam/pospay-ops:<sha> node db/scripts/seed.ts
```

**(to confirm)** — the seed is written to be re-runnable (`ON CONFLICT`, `packages/db/src/seed.ts:47-50`). Expected
output: `reference data seeded`.

**3. Create the user.** With the `pospay-ops` image and the same auth variables the `api` container has
(`AUTH_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_TRUSTED_ORIGINS`; the exact list is in
`packages/auth/scripts/create-user.ts:40-62`), passed by name so no value appears on the command line:

```sh
docker run --rm --network dokploy-network --env AUTH_DATABASE_URL --env BETTER_AUTH_SECRET --env BETTER_AUTH_URL --env AUTH_TRUSTED_ORIGINS \
  ghcr.io/lolotam/pospay-ops:<sha> node scripts/create-user.ts --email <test email> --name "Rehearsal Owner" --operator <manager name>
```

Expected: `user created: <id>` and one link. Record the user id; keep the link private; note the time (one hour).
Check one row was added to `platform_audit_log`.

**4. Set the password.**
- With PR-D merged: open the link in a private browser window → the admin "set your password" page → type a password
  twice → success → "go to login".
- Without PR-D (today): open the link; the browser is redirected to `<admin>/set-password?token=…`, which shows the
  admin's not-found page. Copy the token from the address bar and call the API from a terminal **(to confirm against
  Better Auth's reset endpoint)**:

  ```sh
  curl -sS -X POST https://<api host>/v1/auth/reset-password \
    -H 'content-type: application/json' -H 'origin: https://<admin host>' \
    --data '{"token":"<token>","newPassword":"<chosen password>"}'
  ```

Record which of the two happened. A second use of the same link must fail.

**5. Sign in.** `https://<admin host>/login` with the email and password. Expected: the two-factor step or, for a new
account, the dashboard with no workspace. Enrol TOTP at `/security/two-factor`. Record whether the admin forces TOTP
for an owner before anything else (`CLAUDE.md` §8 requires it for owners).

**6. Negative check first.** Before any grant, from the signed-in admin tab's developer console:

```js
await fetch('https://<api host>/v1/companies', { method: 'POST', credentials: 'include',
  headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
  body: JSON.stringify({ name_en: 'Rehearsal Salon', name_ar: 'صالون تجربة', plan_id: '<provisional plan id>' }) })
  .then(async (r) => [r.status, await r.json()])
```

Expected: 403 with the error envelope. The plan id is the constant at `packages/db/src/seed.ts:33`.

**7. Grant, short-lived.**

```sh
docker run --rm --network dokploy-network --env MIGRATION_DATABASE_URL ghcr.io/lolotam/pospay-ops:<sha> \
  node db/scripts/platform-grant.ts --email <test email> --permission create:companies:platform \
  --operator <manager name> --expires <ISO time, one hour ahead>
```

The script runs as `pospay_owner` (`MIGRATION_DATABASE_URL`), the same role `migrate` uses.

**8. Create the company.** Repeat the console call of step 6 with a **new** idempotency key. Expected: 201 and a
company whose `owner_user_id` is the user id from step 3. Send the same request again with the same key: expected
the same body and the `idempotent-replayed: true` header, and still one company.

**9. See it.** Reload the admin. Expected: the workspace selector shows the company (`GET /v1/me/workspaces`). Create a
business and a branch. Record whether the admin has screens for both, or whether only the API routes exist
(`apps/api/src/modules/tenancy/http/businesses.controller.ts:41`, `branches.controller.ts:28`).

**10. Revoke.** Run step 7's command with `--revoke`. Repeat the console call with a new key: expected 403 again.
Check `platform_audit_log` holds the create, the grant and the revoke.

**11. Isolation.** Sign in as an existing staging user of another company: the rehearsal company is not listed and
its ids return nothing.

**12. Device and staff.** In the rehearsal branch: issue a pairing code, register and claim it from a second browser
profile at the POS host, approve it (`apps/api/src/modules/identity/http/devices.controller.ts:77,90,115,133`), create
one employee with a PIN, and sign that employee in on the paired device.

**13. Leave it.** Nothing is deleted (`CLAUDE.md` §5). Rename the company "Rehearsal — do not use" if a rename exists;
otherwise leave it.

## Receipt (one message to the manager thread)

SHA; which image ran each script; the outcome of every numbered step (pass / fail / not possible, with the HTTP
status); G1–G4 each confirmed or cleared; any new gap, named as its own smallest PR; total time. No link, token,
password, URL with credentials, or the test user's full email.

## On production the same steps run with these differences

- The email is the salon owner's; the link is handed to them directly by Waleed, and they set the password
  themselves on the PR-D page.
- The grant expires in one hour and is revoked as soon as the company exists.
- Steps 6 and 8 are done once, by the owner's signed-in session with the manager present, or by a small script the
  manager gives them; no rehearsal company is created on production.
