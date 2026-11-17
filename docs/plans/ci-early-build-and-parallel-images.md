# CI early build and bounded parallel images

## Authority and scope

Waleed approved the remaining CI steps in an independent PR on 2026-11-17. The verbatim source and boundaries are in `briefs/ci-steps-1-and-3-20261117/owner-authority.md`; the Arabic audit append is in `docs/owner-decisions.ar.md` without a new PP number.

Only `.github/workflows/ci.yml`, `CLAUDE.md`, this plan, and that audit append change. Existing package separation, eight API shards, four worker shards, commands, caches, action pins, runners, permissions, secrets references, and release behavior outside this scheduling change stay intact.

## Scheduling and gate contract

- `build` needs only `changes` and runs for `code=true`; it still executes the complete all-app build.
- `admin-document-popup` also needs only `changes`, builds its complete admin production closure itself, and runs the unchanged real browser scenario. It neither reuses nor assumes `build` artifacts.
- The obsolete PR909 diagnostic exception is removed. No failed worker test can satisfy `ci-gate`.
- `ci-gate` retains all current needs. Code requires every result to be `success`; docs-only requires every heavy result to be `skipped`; unknown, failure, and cancellation fail closed.

## Docker execution

1. Plant the existing decoy env files and build `pospay-build-stage:check` alone.
2. Queue production `api`, `migrate`, `worker`, `backup`, `admin`, and `pos` targets with at most two active `docker build` processes on the existing runner.
3. On main only, add `admin-staging` and `pos-staging` with their existing build args. Pull requests do not build these variants.
4. Wait for every started target. Any build failure makes the step fail only after all started children settle; subsequent inspection/push steps do not run after that failure.
5. Inspect the build stage and exactly the event's built targets for env leaks. On main only, log in with the existing scoped token and push all eight SHA-tagged images. PRs push nothing.

The two-process bound addresses the identified RAM risk without a runner upgrade or cache redesign. No duration improvement is claimed before real runs.

## Parent verification

- Parse the complete YAML and assert the exact job/needs graph, unchanged matrices and commands, no PR909 reference, and no new action or cache.
- Evaluate the gate script for code/docs/unknown classification crossed with success, skipped, failure, and cancelled results, including `changes` failure and each individual heavy-job failure.
- Extract the image build shell and run it with a Bash `docker` stub that logs targets, tracks active/maximum builds, and injects configurable failures. Cover PR/main inventories, maximum two, prebuild failure, every background target position, all-children-settled, and nonzero propagation.
- Stub `docker run`, login, and push to prove PR/main leak-check inventories, build-stage inclusion, main-only push inventory, and inspection failure propagation.
- After application, run normal CI on the exact head and compare successful run wall time and summed job durations with the existing evidence. Record memory/build failures; do not substitute billed usage or an estimate.

Astra high review, Judge Sol6.1 high, final panel/Codex receipts, freshness and merge order remain required. Deployment and migration authority remain independent; backup/restore is not a blanket merge gate under the latest owner override.
