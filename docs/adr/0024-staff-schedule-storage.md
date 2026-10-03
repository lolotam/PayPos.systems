# ADR-0024 — Concrete schedules and scoped schedule reads

Accepted technical implementation, 2026-10-03. Business rules are in spec 020.

Staff owns weekly schedule aggregates and separate concrete shift rows. Each shift stores
the entered local day/times, start-day working_date and resolved UTC interval. The aggregate
stores the timezone used. Attendance PRs 22/24 can read scheduled start/end directly without
reinterpreting overnight shifts. Editing a template never modifies an applied copy.

Reuse ADR-0021's installed btree_gist extension for an employee/tenant-wide exclusion over
half-open UTC intervals. This prevents overlaps across branches and week boundaries even for
concurrent direct database writers. Replacing an aggregate removes only its nonfinancial
shift components; immutable before/after audit retains every previous pattern and reason.
For a multiweek replacement all target components are removed before copies are inserted,
within the same transaction, avoiding temporary overlap with a copy being replaced.

Extend the existing staff→identity boundary with scheduleAccess on the existing tenant Tx.
Identity retains its company→ordered memberships lock protocol and effective permission/DENY
evaluation. Staff's adapter resolves actual branch ownership and PR 19 timezone through the
existing tenancy.describeWorkspaces surface. No new module arrow or outbox event. Query
access is injected beside the query like EmployeeDetailAccess; writes use the staff port.
No npm dependency or new startup configuration. Schedule permissions receive the explicit
default role bundles recorded in spec 020, both in migration and reference seed.

Timezone gap/fold refusal and template conflict replacement remain TODO(spec) SC-Q2/SC-Q1.
No local-time occurrence or merge policy is silently invented. Synchronous application is
temporarily bounded to 20 employee-week copies, with at most 12 chosen weeks. A 240-copy
maximum-pattern benchmark took 897 ms; larger requests are refused until the BullMQ path
is delivered in a follow-up. No partial splitting of an atomic selection is performed.
Bulk reads/writes and the canonical redacted audit writer use bounded SQL batches.
