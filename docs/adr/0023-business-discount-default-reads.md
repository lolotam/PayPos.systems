# ADR-0023 — Business discount default reads

Status: Accepted (Phase 1 PR 7c implementation direction).

## Context

D-56 stores a personal limit in identity (PR 7b) and a business default in existing
settings. PR 35 needs effective authority inside its recording transaction.
Settings writes also need PR 7's current, locked grant snapshot.

## Decision

Settings owns storage and pure effective-limit resolution. Its persistence adapters
read identity's public scoped membership reader and locked business discount access
capability, through settings-owned ports. Tenancy's public businessDiscountScope
reader confirms the business and branches before identity filters its memberships;
identity's query does not join business/branch tables. Declare reads in module-map.md.
Identity imports no settings code. Authority checks reuse evaluateAccess and the
PR 7 company -> ascending membership -> business -> settings lock protocol. A final
authority read takes no new locks and samples statement time after the settings-row wait.
Existing manage:settings:business plus manage:discounts:company possession at the
business and descendants applies; no default grant or new permission code.

PR 35 may call settings' effective-limit reader through its own read port, passing
the existing tenant Tx. Compatible SHARE locks on company, target membership and settings
in that order precede metadata reads and remain held until the consumer commits. This
keeps personal/default values consistent under READ COMMITTED without cross-context SQL
joins or changing the consumer's isolation level. Company locks also serialize normal
discount/owner configuration commands; membership/settings locks protect direct row writes.
After all read-lock waits, the subject adapter samples one fresh clock_timestamp() and
passes it to identity for both target and owner-holder eligibility. The SQL timestamp
is passed as text to preserve Postgres precision; transaction-start now() cannot keep
an expired membership active while the reader waits. The standalone PR 7b personal
reader retains its existing transaction-time semantics.
Reads bypass cached settings for transaction consistency.
An active owner holder is unlimited; otherwise person -> business -> NOT_CONFIGURED.
Owner decision 2026-10-03: the last state stays visible; PR 35 enforces it as 0%, with
approval for every positive discount. The calendar template stays Gregorian.

## Consequences

One settings store and no import cycle, cross-module write or runtime privilege.
Business scope and active holder metadata are identity-owned. An additive nullable
column preserves old settings and the existing RLS/FK/index guarantees. No dependency.
