# MOB M-1 — the «PosPay Business» app shell, built for iOS and Android in CI

Track `MOB` (roadmap MOB-14 … MOB-19). Decision record: `docs/adr/0055-store-apps-capacitor-shell.md` (Proposed).
Owner questions: [owner-questions.ar.md](owner-questions.ar.md) (APP-Q2 … APP-Q7, PENDING). Spec number 065 is
provisional (061 is claimed by open PR #439) and is renumbered at merge, like the ADR number.

## Goal of M-1

At the end of M-1, every merge to `main` that touches the app's inputs produces an Android build and an iOS simulator
build of «PosPay Business» as CI artifacts, from the same `apps/pos` code the PWA runs, and the auth risk of ADR-0055
decision 3 is answered with evidence. **M-1 pays nothing and creates no store account.** Signed builds and TestFlight /
Play internal uploads are M-2, gated on Abu Salem's APP-Q1 pick and on APP-Q3 … APP-Q6.

## Rules that hold for every sub-PR

- One sub-PR per row below, each with its own branch, worktree and PR; PR body starts
  `Feature: MOB — تطبيقات الموبايل (sub-PR M-1x)`.
- **MiniMax writes the production code and tests (PP-10.1).** It has no shell (SA-7.1), so the orchestrator runs every
  generator and native tool itself (`pnpm install`, `npx cap add ios|android`, `npx cap sync`, Gradle, `xcodebuild`) and
  commits generated native projects as generated files, the way `api:generate` output is handled.
- New dependencies are pinned to one exact version and must pass `pnpm-workspace.yaml`'s minimum release age.
- Any edit under `apps/pos/**`, `CLAUDE.md`, `.github/workflows/ci.yml`, `turbo.json`, `.dockerignore`, `.prettierignore`
  or the ESLint config is announced to the PosPay web manager **before** the branch is cut (shared files).
- Operations steps (Dokploy environment, files served from a `pospay.systems` host) are done by the web manager on
  staging and by Waleed on production. They are listed as `O-n` and are never part of a code PR.
- Gates: `pnpm check` for code sub-PRs; the four review bots on the head SHA; SA-11 self-merge to staging only when all
  gates are green.

## Sub-PRs

| # | Title | Main files | Depends on | Done when |
| --- | --- | --- | --- | --- |
| M-1a | Shell scaffold and native build mode | new `apps/business/` (`package.json`, `capacitor.config.ts`, generated `ios/`, `android/`, `README.md` with the secret names, empty values); `apps/pos/vite.config.ts` (`native` mode → `dist-native`, no service-worker registration); `turbo.json` task for `@pospay/pos#build:native`; ignores in `.dockerignore`, `.prettierignore`, ESLint; `CLAUDE.md` §2.1 line for `apps/business` | ADR-0055 merged | `pnpm turbo run build` on Linux stays green and does **not** need Xcode or the Android SDK; `cap sync` copies `dist-native` into both projects; the web PWA build output is byte-for-byte unchanged in behaviour (service worker still registered on the web) |
| M-1b | `mobile.yml` stages A and B | new `.github/workflows/mobile.yml`: Android debug APK + unsigned AAB on `ubuntu-latest`, iOS simulator build without signing on `macos-latest`, path filter `apps/pos/**`, `apps/business/**`, `packages/**`, the workflow itself; artifacts kept 14 days; advisory (not required) | M-1a | Both jobs green on the PR and on `main`; the PR body reports the measured macOS minutes per run; no secret is referenced |
| O-1 | Staging origins (operations) | Dokploy env of `pospay-staging`: add the app origins to `AUTH_TRUSTED_ORIGINS` and the API CORS list — `https://pos.staging.pospay.systems` is already there (Android); add `capacitor://pos.staging.pospay.systems` (iOS) | M-1a (origins known) | Web manager confirms the change; staging still serves the PWA unchanged |
| M-1c | Auth spike and its record | the debug builds of M-1b; a short results section appended to this plan; if needed, `capacitor.config.ts` plugin config for `CapacitorHttp` / `CapacitorCookies` and `WKAppBoundDomains` in `ios/App/App/Info.plist` | M-1b, O-1 | Recorded, per platform, against staging with a seeded test company: (a) device pairing, (b) staff PIN session, (c) personal OTP session — each opens and survives an app restart; (d) what passkey attendance does. Android on a real phone (side-loaded debug APK); iOS on the simulator of the macOS runner, and on a real iPhone once M-2 gives TestFlight. **If iOS (b) or (c) fails with both cookie paths, the track stops here** and ADR-0055's last fallback goes to the owners and the web manager as a new ADR addendum |
| M-1d | Native capability ports in `apps/pos` | `apps/pos/src/shared/platform/` (one port: `isNativeShell()` and the capabilities it reports); the Web Push control (spec 063) and passkey attendance read it and hide on native; UI tests assert the hidden state on screen, not a mock call (`CLAUDE.md` §9) | M-1c | The PWA behaves exactly as before; in the native build the two controls are absent and a short line tells the employee to use the PWA for them; `pnpm check` green |
| M-1e | App identity | `apps/business`: display names, icons and splash for both flavours (staging badge on the staging icon), RTL default, Arabic first; app id per flavour from APP-Q6 | M-1a, **APP-Q2 and APP-Q6 answered** | Both flavours install side by side on one Android phone; the names and ids match the recorded answers |
| M-1f | Minimum supported app version | spec of its own first (a small public read route in the API plus a blocking "please update" screen in `apps/pos` native mode) | M-1d | Its own spec, ADR note and owner questions if any; listed here so the store lag of ADR-0055 is not forgotten |

## M-2 — signed builds and internal distribution (not started; gated)

Starts only when **Abu Salem confirms APP-Q1** and **APP-Q3 … APP-Q6 are answered**. It needs, in this order:

1. **O-2 (owners):** the account holder enrols in the Apple Developer Program and creates the Google Play developer
   account, in the name recorded in APP-Q3 (D-U-N-S from APP-Q4 for an organisation account), and publishes the privacy
   policy at the URL of APP-Q5.
2. **O-3 (owners):** the account holder creates, on their own machine, the App Store Connect API key, the distribution
   certificate and profiles, the Android upload keystore and the Play service account, and stores them as secrets of the
   GitHub environment `mobile-release` (required reviewer: Waleed). No agent sees or handles the values.
3. **O-4 (web manager / Waleed):** serve `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
   from the relying party's host (`pospay.systems`; `staging.pospay.systems` for the staging flavour), and agree the
   `packages/auth` change that lets the iOS origin use passkeys (an ADR-0027 addendum, issue #536; ADR-0055 decision 3).
4. **M-2a:** `mobile.yml` stage C — fastlane (`Gemfile.lock` pinned) builds and signs both flavours on `push` to `main`
   and uploads them to TestFlight internal and Play internal testing; the testers are the list of APP-Q7.
5. **M-2b:** passkey attendance in the app once O-4 is green (re-enables what M-1d hid).

Public store release (MOB-17) is a separate step after M-2 and needs Waleed's typed yes, like a production deploy.

## Later rows of the track

- **MOB-18** cashier mode in the app: the cashier screens land in `apps/pos` first (web), then the printer and card
  terminal plugins behind the M-1d port; its own spec.
- **MOB-19** native push on `push_subscriptions`: its own ADR (ADR-0055 decision 8 lists what it must decide).
- **MOB-16** customer app: its own ADR (React Native + Expo is the recorded candidate, ADR-0055 decision 7).

## Open risks

| Risk | Where it is answered |
| --- | --- |
| iOS `capacitor://` origin drops the `SameSite=Lax` session cookies | M-1c (spike), fallback order in ADR-0055 decision 3 |
| Passkeys inside the WebView | M-1c records it; M-2b with O-4 |
| A real iPhone needs signing, so the iOS spike first runs on the simulator | Rechecked on a real iPhone in M-2a's first TestFlight build |
| macOS runner minutes | Measured in M-1b; moves to `main`-only plus manual dispatch if too high |
| Installed apps lag behind the server | M-1f |
