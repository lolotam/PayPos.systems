# Specification Quality Checklist: Branch attendance QR

**Created:** 2026-10-02
**Feature:** [spec.md](../spec.md)

- [x] Scope is plan row 19, with clocking, passkeys, geofence and the state machine excluded.
- [x] User journeys, acceptance scenarios, edge cases and measurable outcomes are defined.
- [x] Slice design covers contracts, device-only access, events, RLS reuse and tests.
- [x] Implementation choices are confined to slice design and explicit assumptions.
- [x] No table or migration is needed; AttendanceSession remains a PR 22 seam.
- [x] Required dependency pin and module-map read declaration are recorded in ADR-0020.
- [x] Local-midnight rotation and rollover tolerance are recorded (owner decision 2026-10-03, ADR-0020).
