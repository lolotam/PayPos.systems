# #828 — membership refresh preparation

## Scope

Extract the existing refresh spec response/render fixtures and owned read holds.
Production behavior and permission semantics remain unchanged.
The full polling-focus and mutation-authority fix remains outstanding under #828.

## Preservation

Keep all six original Arabic/English and company/business variants and their titles.
Keep all 22 existing assertion sites, exact query keys and current pending-hide behavior.
Set `Draft retained across refresh` once; observe it after real successful recovery.
The same held GET moves from pending to rejection; recovery uses a separate refetch.
Retire selection through the real empty-list response and retain cached-data assertions.
Production/default retry:false, polling intervals and assertion timeouts stay unchanged.

## Support lifetime

Register each hold before exposing its pending promise.
Explicit release removes its registration; cleanup releases every outstanding owned hold.
Exercise pending/settlement, multiple-hold draining, empty registry and repeated draining.
Retain component unmount, owned client clearing and HTTP mock reset after every case.
No unused validation decorator, gate/query/policy mock or production seam is introduced.

## Validation and delivery

Focused refresh/support and unchanged table/panel regressions await a coordinated turn.
Configured typecheck, scoped lint, docs, boundaries/module-map and format checks are required.
No runtime, native-focus or full-feature fit claim follows from this preparation.
Independent CODE review and exact-head review/CI/backup/freshness/merge gates remain.
Use Refs #828; keep the issue open for the complete T0–T7 fix after prep delivery.
