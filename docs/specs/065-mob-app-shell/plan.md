# MOB M-1 — the «PosPay Business» app shell, built for iOS and Android in CI

Track `MOB` (roadmap MOB-14 … MOB-19). Decision record: `docs/adr/0055-store-apps-capacitor-shell.md` (Proposed).
Owner questions: [owner-questions.ar.md](owner-questions.ar.md) (APP-Q2 … APP-Q7, batch 55, PP-39.1 … PP-39.6,
answered by both owners on 2026-10-23). This PR merges after PR #532, which records APP-Q1. Spec number 065 is
provisional (061 is claimed by open PR #439) and is renumbered at merge, like the ADR number.

## Goal of M-1

At the end of M-1, every merge to `main` that touches the app's inputs produces an Android build of «PosPay Business»
as a CI artifact, from the same `apps/pos` code the PWA runs, and the auth risk of ADR-0055 decision 3 is answered on a
real Android phone. **iOS follows APP-Q8:** there is no Mac, and Waleed picked the GitHub macOS runner with the iOS
simulator, **inside the free minutes only** (Abu Salem picked the same; final). CI then also produces
an iOS simulator build on `main` and the iOS cookie question is answered on the simulator. Android device testing
starts now at no cost. The first real-iPhone check is the first TestFlight build (M-1c-ii, inside M-2). **M-1 pays nothing and creates no store account.** Signed builds and TestFlight /
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
| M-1a | Shell scaffold, native build mode and start screen | new `apps/business/` (`package.json`, `capacitor.config.ts`, generated `ios/`, `android/` with the two flavours as native build variants — Android `productFlavors` with their own `applicationId`, iOS build configurations with their own bundle id, since `cap sync` does not rewrite either — `README.md` with the secret names, empty values); `apps/pos/vite.config.ts` (`native` mode → `dist-native`, no service-worker registration); `turbo.json` task `@pospay/pos#build:native` with outputs `dist-native/**`, and the `apps/business` sync task depending on it by name (`^build` would only run the PWA build); ignores in `.dockerignore`, `.prettierignore`, ESLint; `CLAUDE.md` §2.1 line for `apps/business`; the native start screen of the spec in `apps/pos/src/app/`; the Android verified `intent-filter` for `https://<pos host>/personal`, with the link handling of FR-012 (the iOS Associated Domains entitlement moved to M-1b: it needs an Xcode project edit only the macOS runner can check, and a tapped link opens the app only from M-2; orchestrator, 2026-10-23) | M-1·0; APP-Q9, Q12, Q14, Q15 and Q16 are answered (Waleed and Abu Salem, 2026-10-23, final), so a second M-1a round adds the link handling and paste (FR-012), the phone-language default (FR-015), rotation on both devices (FR-016), the owner line (FR-017, only after spec 067's sub-PR 067-2; who counts is spec 067 BR-003) and the business switch (FR-012, after spec 067's sub-PR 067-1, which gives both sign-out routes an explicit `NO_SESSION` result) and the role change (FR-008, after 067-1 and also after the server-side session fence of #581); the back-office QR screen is M-1g and the in-app scan is M-1h (FR-014) | `pnpm turbo run build` on Linux stays green and does **not** need Xcode or the Android SDK; `cap sync` copies `dist-native` into both projects; a staging and a production debug build carry different ids, and each one's bundle holds its own API origin (checked by reading the built app); the web PWA build output is byte-for-byte unchanged in behaviour (service worker still registered on the web); the native build opens on the start screen and both choices reach their flow; UI tests assert what is on screen |
| M-1b | `mobile.yml` stages A and B, with the macOS hard stop | new `.github/workflows/mobile.yml`: Android debug APK + unsigned AAB on `ubuntu-latest`; iOS simulator build without signing on `macos-latest`, **inside the free minutes only (APP-Q8):** it runs on `push` to `main` when the inputs change, on `workflow_dispatch`, and on a PR only when it changes `apps/business/**`, `mobile.yml` or a `@capacitor/*` dependency (such a PR merges only with stage B green on its head); the **macOS guard keeps the six rules of ADR-0055 decision 6** (an Ubuntu admission check before any macOS runner; atomic slots bounded at K across refs; this repository's own macOS minutes for the month counted with `GITHUB_TOKEN` (`actions: read`), no account token (APP-Q20); refuse at a fixed monthly macOS allowance with room for K jobs; each admission owned by one job attempt with a lease; fail closed); this sub-PR chooses and tests the mechanism and sets K, the timeouts, the lease and the monthly allowance; the guard counts only while the repository is private (public repository: admitted with no counting, ADR-0055 decision 6; a `guard: enforce` dispatch runs the six rules anyway); set in M-1b: K = 2 (one slot per flavour), job timeout 45 min, lease 120 min, monthly allowance 180 macOS minutes (private mode only; admission needs `count + K × timeout <= allowance`, so one run of both flavours needs room for 3 × 45; to be revised from measurement); the iOS Associated Domains entitlement `applinks:<pos host>` (an `App.entitlements` file, with `CODE_SIGN_ENTITLEMENTS` and the POS host in each flavour's xcconfig, so the project file is not hand-edited), built and checked here (moved from M-1a, orchestrator 2026-10-23); concurrency groups per ref; one flavour per job, with `FLAVOUR` in the Turbo task's `env`; a `changes` job (inputs: `apps/pos/**`, `apps/business/**`, `packages/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root `package.json`, `turbo.json`, `.nvmrc`, the workflow) and an always-present `mobile-gate`, the `ci.yml` pattern, no workflow-level `paths`; artifacts kept 14 days; `mobile-gate` advisory (not required) | M-1a, O-5 | On this PR itself (it changes `mobile.yml`, so stage B runs): the Android job and the iOS job green, the measured macOS minutes per run in the PR body, each of the six rules shown by a test run (refusal with no macOS runner started when the allowance is forced low, when the job history cannot be read and when K slots are held; a single-job re-run ending in its first minute and that minute appearing in the finished-job count; a job that waited in the runner queue still accepted within its lease; one job unable to use another job's admission); the measured multiplier recorded; after merge, both green on `main`; after the first week the account's usage is reported to Waleed before anything could be billed; the only secrets are, for `ios-spike`, repository secrets holding staging test values |
| O-5 | Actions budget at $0 (owner) | GitHub account billing settings: the Actions budget is $0 with «stop usage when budget limit is reached», so a run is blocked rather than charged; if GitHub does not accept $0 (or the stop option is unavailable), **no other amount is set**: the macOS work stays stopped and the question goes back to Waleed; Waleed checks account usage on the billing page once a week (APP-Q20). No token is created (APP-Q20 replaced the earlier usage-read token). No agent changes account settings | — (needed before M-1b's first macOS run) | Waleed confirms the setting before the first macOS run |
| O-1a | Staging origins for Android (operations) | none: the Android origin `https://pos.staging.pospay.systems` is already in `AUTH_TRUSTED_ORIGINS` and the API CORS list; the web manager only confirms it | M-1a | Web manager confirms |
| O-1b | Staging origin for iOS (operations) | Dokploy env of `pospay-staging`: add `capacitor://localhost` to `AUTH_TRUSTED_ORIGINS` and the API CORS list **only after the ADR-0027 addendum of issue #549 allows it** (ADR-0027 requires exact POS origins) | M-1a, #549 | Web manager confirms the change; staging still serves the PWA unchanged |
| O-6 | App-link files on the POS host (operations, in M-2) | serve `/.well-known/apple-app-site-association` (with the Apple Team ID) and `/.well-known/assetlinks.json` (with the Play App Signing certificate fingerprint) from `pos.staging.pospay.systems` (Waleed: `pos.pospay.systems`), matching the app ids; the POS host, never the passkey host of O-4 | O-2, O-3, APP-Q9 | A tapped manager link opens the signed internal build on Android and iOS |
| M-1c | Auth spike and its record | the debug builds of M-1b; a short results section appended to this plan; if needed, `capacitor.config.ts` plugin config for `CapacitorHttp` / `CapacitorCookies` and `WKAppBoundDomains` in `ios/App/App/Info.plist` | Android: M-1b, O-1a; iOS (a)–(c): also O-1b (#549) | Recorded, per platform, against staging with a seeded test company: (a) device pairing, (b) staff PIN session, (c) personal OTP session — each opens and survives an app restart; (d) the attendance QR camera opens and reads a code; (e) what passkey attendance does. **Android:** (a)–(e) on a real phone with a side-loaded debug APK. **iOS, no Mac (method per APP-Q8; recommended):** (a)–(c) as an automated UI test (XCUITest) on the simulator of the GitHub macOS runner, run by a `workflow_dispatch` job `ios-spike` in `mobile.yml` (added in M-1b, behind the same preflight; neither job declares an environment) against a seeded staging test company; that job declares no environment, so no signing secret can reach it; staging test logins come from the seed or from **repository** secrets holding staging test values only (a job with no environment cannot read environment secrets), never from the signing environments. (d) and (e) on iOS move to M-1c-ii. **M-1d onward waits for this result, and so does the Apple fee.** If iOS (b) or (c) fails with both cookie paths, the track stops here and ADR-0055's last fallback goes to the owners and the web manager as a new ADR addendum; if (d) fails, a native camera plugin behind the M-1d port is added before attendance is enabled in the app |
| M-1d | Native capability ports in `apps/pos` | `apps/pos/src/shared/platform/` (one port: `isNativeShell()` and the capabilities it reports); the Web Push control (spec 063) and passkey attendance read it and hide on native; UI tests assert the hidden state on screen, not a mock call (`CLAUDE.md` §9) | M-1c | The PWA behaves exactly as before; in the native build the two controls are absent and a short line tells the employee to use the PWA for them; `pnpm check` green |
| M-1e | App identity | `apps/business`: display names, icons and splash for both flavours («تجربة» on the staging icon, APP-Q13; details APP-Q21…APP-Q25, batch 69: a navy «B» circle in the icon's corner, a purple diagonal «تجربة» ribbon on the staging icon, a purple «نسخة تجربة» strip, the same name in both flavours, a light cream splash (APP-Q25, Abu Salem's pick, which replaced Waleed's orange after #627 merged); Abu Salem answered all five on 2026-10-24; `TODO(spec)` the icon mark and the final look wait on the example images and suggestions he will send, see the spec's batch 69 note), and in `apps/pos` a coloured strip at the top of every screen of the staging flavour (APP-Q13), driven by the flavour flag, RTL default, Arabic first; app id per flavour from APP-Q6 (`systems.pospay.business`, `.staging`); name «PosPay Business» in every language, with no Arabic name (APP-Q2, final on 2026-10-24) | M-1c | Both flavours install side by side on one Android phone; the names and ids match the recorded answers |
| M-1f | Minimum supported app version | spec of its own first, `docs/specs/066-mob-min-app-version/spec.md` (a static file changed by a deploy, not an API route, since `CLAUDE.md` §6 allows no unguarded endpoint; read through the native HTTP plugin, because on Android Capacitor answers the app's own hostname, the POS host, from the bundled assets and a WebView read from another host would need CORS; plus a blocking "please update" screen in `apps/pos` native mode) | M-1d | Its own spec merged and built; **M-2a depends on it**, so the first signed build already carries the check |
| M-1g | Back-office employee-app link and QR (`apps/admin`) | a screen in the back office that shows the manager the employee-app link `https://<pos host>/personal?company=…&business=…` and its QR code (one link per business, EL-Q1, Waleed's pick; Abu Salem pending) (APP-Q9: both); its own spec, [069](../069-mob-employee-link-qr/spec.md), owner questions EL-Q1…EL-Q5 pending; agreed with the web manager because it is `apps/admin` | M-1·0 | The manager can copy the link, show and print its QR code, and open WhatsApp with it (EL-Q4) |
| M-1h | In-app QR scan (FR-014) | in `apps/pos`: a «امسحي كود الصالون» option on the employee connect screen that reads the QR with the attendance camera and hands its content to the FR-012 parser; hidden with the FR-007 line wherever the camera port is off | M-1d (camera port), M-1g (QR exists) | Scanning a valid QR connects the business on Android (M-1c camera check passed); on iOS the option stays hidden until M-1c-ii passes; test MOB-T20 |

## M-2 — signed builds and internal distribution (not started; gated)

APP-Q1 is final and APP-Q2 … APP-Q7 are answered. M-2 starts only when **the company that will own the store accounts
is formed** (APP-Q3; its legal name is `TODO(spec)` until then — Waleed's temporary working name «PosPay», 2026-10-24, is a note for the docs and the privacy-policy draft only, never for an account or a payment) **and M-1c is green** (Android on a real phone; iOS as APP-Q8 decides) **and M-1f is merged**. It needs, in this
order:

1. **O-2 (owners):** the account holder (Abu Salem, APP-Q3) enrols in the Apple Developer Program and creates the Google Play developer
   account, in the company's name (APP-Q3), with the D-U-N-S number requested for free once the company exists (APP-Q4;
   the owners discuss it at their next meeting), and the privacy policy is published at `https://pospay.systems/privacy`
   in Arabic and English (APP-Q5: we draft it, the owners or their lawyer review it).
2. **O-2b (owners):** the account holder creates the store records before any automated upload: an App Store Connect
   app record per flavour, and per flavour a Play Console app with its first build uploaded by hand (the stage-A AAB
   signed with the upload key), because Play's API refuses uploads to an app that has none.
3. **O-3 (owners):** the account holder creates, on their own machine, the App Store Connect API key(s), the
   distribution certificate and the provisioning profiles, the Android upload keystore and **two** Play service
   accounts (one granted only the staging app, one only the production app). They go into two GitHub environments,
   both with a deployment-branch policy of `main` only: `mobile-staging` (no reviewer) gets **only the staging-app
   credentials**, and `mobile-production` (required reviewer: Waleed) gets the production ones (ADR-0055 decision 5).
   No agent sees or handles the values.
4. **O-4 (web manager / Waleed):** serve `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
   from the relying party's host (`pospay.systems`; `staging.pospay.systems` for the staging flavour), and agree the
   `packages/auth` change that lets the iOS origin use passkeys (an ADR-0027 addendum, issue #536; ADR-0055 decision 3).
5. **M-2a:** `mobile.yml` stage C — fastlane (`Gemfile.lock` pinned), one flavour per job end to end (ADR-0055 decision 6).
   **C1** builds and signs the **staging flavour** after every merge (the newest merge always gets a build) and uploads
   it to TestFlight and Play internal testing, with the `mobile-staging` secrets, which can upload only the staging app.
   **C2** builds the **production flavour** only by a `workflow_dispatch` run that takes no commit input: it builds the
   commit of a `production-*` tag, checks that the commit is on `main` and is the one deployed to the production API,
   and then uses the `mobile-production` secrets, which hold the run until Waleed approves it. M-2a also confirms
   whether App Store Connect can limit an API key to the staging app (if not, iOS staging uploads also need his
   approval). The testers are the list of APP-Q7. TestFlight **internal**
   testers must be App Store Connect users of the account, so only the owners go there; salon employees go to a
   TestFlight **external** group, whose first build passes Apple's beta review. Play internal testing takes plain e-mail
   addresses.
6. **M-1c-ii, the first real iPhone:** the first TestFlight build of M-2a, installed by the owners only (TestFlight
   internal), repeats (a)–(c) and adds (d) the camera on iOS and records (e) what passkeys do (they are expected to be refused until issue #536 and O-4
   land; M-2b turns them on). Until it passes, no employee gets the iOS
   app (no external group) and attendance stays hidden on iOS.
7. **M-2b:** passkey attendance in the app once O-4 is green (re-enables what M-1d hid).

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
| No Mac, so no real iPhone before the paid account | iOS cookies answered on the simulator in M-1c; the real iPhone in M-1c-ii (owners only) before any employee gets it. A paid device farm could test a real iPhone sooner, but it costs money and is not proposed; it would be an owner question |
| The camera scanner needs a secure context in the WebView | M-1c (d); native camera plugin as fallback |
| macOS runner minutes | Free minutes only (APP-Q8, APP-Q20): the guard rules of ADR-0055 decision 6 (Ubuntu admission check, atomic slots, this repository's own macOS minutes counted with `GITHUB_TOKEN` against a fixed monthly allowance, one admission per job attempt, fail closed); Waleed's weekly look at account usage; the $0 budget (O-5) as backstop; the first week reported to Waleed before anything could be billed |
| Installed apps lag behind the server | M-1f |
