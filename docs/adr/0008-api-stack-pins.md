# ADR-0008 — API stack pins and dependency injection without decorator metadata

- **Status:** Accepted
- **Date:** 2026-09-23
- **Slice:** Phase 0 · T6b — `apps/api` foundation

## Context

`06` §1 fixes NestJS on the Fastify adapter, pino, Redis and BullMQ. T6b is the first code that uses them, so
the versions and one framework convention have to be decided.

## Decision

| Package | Version | Why this one |
|---|---|---|
| `@nestjs/{core,common,platform-fastify,testing}` | **12.0.3** | NestJS 12 (2026-08-27) for a greenfield API instead of starting on 11 and migrating soon; 12.0.4 was two days old, inside pnpm's minimum release age |
| `fastify` | **5.12.4** | the exact version `@nestjs/platform-fastify` 12.0.3 pins, declared so the API can import its types without a second copy |
| `pino` | **10.3.1** | in `@pospay/observability` only; Fastify takes the logger as `loggerInstance` |
| `ioredis` | **6.0.0** | the client BullMQ uses; one Redis client library for the whole repo |
| `reflect-metadata` / `rxjs` | 0.2.2 / 7.8.2 | NestJS peers |

**Dependency injection is explicit.** Every constructor dependency is injected with `@Inject(TOKEN)`, and
`emitDecoratorMetadata` is **off**. Vitest compiles with esbuild, which cannot emit decorator metadata; relying on
it would need SWC just for tests and would make tests and production compile differently. Explicit tokens are what
ports need anyway — a port is an interface, which has no runtime type to inject by. `experimentalDecorators` stays
on, because NestJS still uses legacy decorators.

**Logging — nothing is printed that a value could smuggle through** (CLAUDE.md §8; four Codex review rounds).
`@pospay/observability` owns the logger; the API never configures pino itself.

- **Messages are catalogued event names.** Each process registers its events (`API_LOG_EVENTS`); any other message
  is replaced by "log message withheld". Dynamic values go in fields. A lint rule rejects built-up messages.
- **Fields are sanitised at any depth** (secret keys in any casing, arrays, cycles); phone numbers keep 3 digits;
  functions and `toJSON` hooks are dropped. It runs at pino's entry (`hooks.logMethod`), on every line, and on the
  bindings of every child logger (wrapping pino's prototype methods, so children keep their own bindings).
- **Errors are a recognised type and a recognised code only.** Names and codes come from finite lists. **No message,
  cause or stack trace is logged** — stack text starts with the message and a multiline message can imitate any
  frame. Trade-off: production logs carry no stack traces; proper error capture with scrubbing is T11's job.
- **Requests are one line:** method, route **pattern**, status, duration. Fastify's own request logging (raw URL) is
  off (`LogController`); Nest logs through a sanitising adapter; ioredis errors go through an `error` listener.

## Consequences

- A class injected without `@Inject` fails at startup — the first test that builds the app shows it.
- `/health` and `/ready` sit at the root; every other route is under `/v1`.
- `@typescript-eslint/no-extraneous-class` allows decorated classes, so a `@Module()` class with only a static
  `forRoot` is permitted; undecorated static-only classes are still rejected.
- Upgrading NestJS or Fastify is a deliberate PR that updates this table.
