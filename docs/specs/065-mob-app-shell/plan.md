# MOB M-1 — the «PosPay Business» app shell, built for iOS and Android in CI

Track `MOB` (roadmap MOB-14 … MOB-19). Decision record: `docs/adr/0055-store-apps-capacitor-shell.md` (Proposed).
Owner questions: [owner-questions.ar.md](owner-questions.ar.md) (APP-Q2 … APP-Q7, batch 55, PP-39.1 … PP-39.6,
answered by both owners on 2026-10-23). This PR merges after PR #532, which records APP-Q1. Spec number 065 is
provisional (061 is claimed by open PR #439) and is renumbered at merge, like the ADR number.

## Goal of M-1

At the end of M-1, every merge to `main` that touches the app's inputs produces an Android build and an iOS simulator
build of «PosPay Business» as CI artifacts, from the same `apps/pos` code the PWA runs, and the auth risk of ADR-0055
decision 3 is answered with evidence from a real iPhone and a real Android phone. **M-1 pays nothing and creates no store account.** Signed builds and TestFlight /
Play internal uploads are M-2, gated on the company that will own the store accounts being formed (APP-Q3).

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
| M-1·0 | Slice spec | `docs/specs/065-mob-app-shell/spec.md` through `/speckit-specify` (docs-only): requirements, edge cases and acceptance criteria for the shell, the native start screen («this counter device» / «my employee account», remembered on the phone; today the personal screens are reachable only at `/personal`, `apps/pos/src/app/app.tsx`), offline cold start, the auth and camera checks of M-1c, what is hidden on native (M-1d), and tests; any new owner question goes to the orchestrator first | ADR-0055 merged | Spec merged; no production code starts before it (`CLAUDE.md` §1) |
| M-1a | Shell scaffold, native build mode and start screen | new `apps/business/` (`package.json`, `capacitor.config.ts`, generated `ios/`, `android/`, `README.md` with the secret names, empty values); `apps/pos/vite.config.ts` (`native` mode → `dist-native`, no service-worker registration); `turbo.json` task for `@pospay/pos#build:native`; ignores in `.dockerignore`, `.prettierignore`, ESLint; `CLAUDE.md` §2.1 line for `apps/business`; the native start screen of the spec in `apps/pos/src/app/` | M-1·0 | `pnpm turbo run build` on Linux stays green and does **not** need Xcode or the Android SDK; `cap sync` copies `dist-native` into both projects; the web PWA build output is byte-for-byte unchanged in behaviour (service worker still registered on the web); the native build opens on the start screen and both choices reach their flow; UI tests assert what is on screen |
| M-1b | `mobile.yml` stages A and B | new `.github/workflows/mobile.yml`: Android debug APK + unsigned AAB on `ubuntu-latest`, iOS simulator build without signing on `macos-latest`; a `changes` job (inputs: `apps/pos/**`, `apps/business/**`, `packages/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root `package.json`, `turbo.json`, `.nvmrc`, the workflow) and an always-present `mobile-gate`, the `ci.yml` pattern, no workflow-level `paths`; artifacts kept 14 days; `mobile-gate` advisory (not required) | M-1a | Both jobs green on the PR and on `main`; the PR body reports the measured macOS minutes per run; no secret is referenced |
| O-1 | Staging origins (operations) | Dokploy env of `pospay-staging`: add the app origins to `AUTH_TRUSTED_ORIGINS` and the API CORS list — `https://pos.staging.pospay.systems` is already there (Android); add `capacitor://localhost` (iOS, ADR-0055 decision 3) | M-1a (origins known) | Web manager confirms the change; staging still serves the PWA unchanged |
| M-1c | Auth spike and its record | the debug builds of M-1b; a short results section appended to this plan; if needed, `capacitor.config.ts` plugin config for `CapacitorHttp` / `CapacitorCookies` and `WKAppBoundDomains` in `ios/App/App/Info.plist` | M-1b, O-1 | Recorded, per platform, against staging with a seeded test company: (a) device pairing, (b) staff PIN session, (c) personal OTP session — each opens and survives an app restart; (d) the attendance QR camera opens and reads a code; (e) what passkey attendance does. **On real devices only:** Android a side-loaded debug APK; iOS a development build installed with Xcode's free personal-team signing on a Mac (no fee, no store account; the profile lasts 7 days). A simulator run may come first but does not close M-1c. **Every later row (M-1d onward) and every M-2 step, including any store fee, waits for this result.** If iOS (b) or (c) fails with both cookie paths, the track stops here and ADR-0055's last fallback goes to the owners and the web manager as a new ADR addendum; if (d) fails, a native camera plugin behind the M-1d port is added before attendance is enabled in the app |
| M-1d | Native capability ports in `apps/pos` | `apps/pos/src/shared/platform/` (one port: `isNativeShell()` and the capabilities it reports); the Web Push control (spec 063) and passkey attendance read it and hide on native; UI tests assert the hidden state on screen, not a mock call (`CLAUDE.md` §9) | M-1c | The PWA behaves exactly as before; in the native build the two controls are absent and a short line tells the employee to use the PWA for them; `pnpm check` green |
| M-1e | App identity | `apps/business`: display names, icons and splash for both flavours (staging badge on the staging icon), RTL default, Arabic first; app id per flavour from APP-Q6 (`systems.pospay.business`, `.staging`); the Arabic name only if APP-Q2's `TODO(spec)` is settled | M-1c | Both flavours install side by side on one Android phone; the names and ids match the recorded answers |
| M-1f | Minimum supported app version | spec of its own first (a small public read route in the API plus a blocking "please update" screen in `apps/pos` native mode) | M-1d | Its own spec, ADR note and owner questions if any; listed here so the store lag of ADR-0055 is not forgotten |

## M-2 — signed builds and internal distribution (not started; gated)

APP-Q1 is final and APP-Q2 … APP-Q7 are answered. M-2 starts only when **the company that will own the store accounts
is formed** (APP-Q3; its legal name is `TODO(spec)` until then) **and M-1c is green on real devices**. It needs, in this
order:

1. **O-2 (owners):** the account holder (Abu Salem, APP-Q3) enrols in the Apple Developer Program and creates the Google Play developer
   account, in the company's name (APP-Q3), with the D-U-N-S number requested for free once the company exists (APP-Q4;
   the owners discuss it at their next meeting), and the privacy policy is published at `https://pospay.systems/privacy`
   in Arabic and English (APP-Q5: we draft it, the owners or their lawyer review it).
2. **O-2b (owners):** the account holder creates the store records before any automated upload: an App Store Connect
   app record per flavour, and per flavour a Play Console app with its first build uploaded by hand (the stage-A AAB
   signed with the upload key), because Play's API refuses uploads to an app that has none.
3. **O-3 (owners):** the account holder creates, on their own machine, the App Store Connect API key, the distribution
   certificate and profiles, the Android upload keystore and the Play service account, and stores them as secrets of the
   GitHub environment `mobile-release` (required reviewer: Waleed). No agent sees or handles the values.
4. **O-4 (web manager / Waleed):** serve `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
   from the relying party's host (`pospay.systems`; `staging.pospay.systems` for the staging flavour), and agree the
   `packages/auth` change that lets the iOS origin use passkeys (an ADR-0027 addendum, issue #536; ADR-0055 decision 3).
5. **M-2a:** `mobile.yml` stage C — fastlane (`Gemfile.lock` pinned) builds and signs both flavours on `push` to `main`
   and uploads them to TestFlight and Play internal testing; the testers are the list of APP-Q7. TestFlight **internal**
   testers must be App Store Connect users of the account, so only the owners go there; salon employees go to a
   TestFlight **external** group, whose first build passes Apple's beta review. Play internal testing takes plain e-mail
   addresses.
6. **M-2b:** passkey attendance in the app once O-4 is green (re-enables what M-1d hid).

Public store release (MOB-17) is a separate step after M-2 and needs Waleed's typed yes, like a production deploy. The owners chose a company account (APP-Q3), so Google's closed-test rule for new
personal accounts (12 testers for 14 days) does not apply; if that ever changes, MOB-17 starts with that closed test.

## Later rows of the track

- **MOB-18** cashier mode in the app: the cashier screens land in `apps/pos` first (web), then the printer and card
  terminal plugins behind the M-1d port; its own spec.
- **MOB-19** native push on `push_subscriptions`: its own ADR (ADR-0055 decision 8 lists what it must decide).
- **MOB-16** customer app: its own ADR (React Native + Expo is the recorded candidate, ADR-0055 decision 7), and before
  it a separate ADR for the customer's view across every business on the platform (Abu Salem's APP-Q1 note), which RLS
  forbids today.

## Open risks

| Risk | Where it is answered |
| --- | --- |
| iOS `capacitor://` origin drops the `SameSite=Lax` session cookies | M-1c (spike), fallback order in ADR-0055 decision 3 |
| Passkeys inside the WebView | M-1c records it; M-2b with O-4 |
| A real-iPhone test needs a Mac with Xcode (free signing) before any account is paid for | M-1c; if no Mac is available the track waits and the owners are told, rather than paying for an account to get TestFlight first |
| The camera scanner needs a secure context in the WebView | M-1c (d); native camera plugin as fallback |
| macOS runner minutes | Measured in M-1b; moves to `main`-only plus manual dispatch if too high |
| Installed apps lag behind the server | M-1f |
