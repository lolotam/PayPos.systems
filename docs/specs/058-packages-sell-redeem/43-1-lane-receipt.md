# 43-1 migration lane grant

Manager instruction relayed at 03:00 Kuwait explicitly grants this lane and
supersedes the earlier queue hold. Order: #793 (0204), 43-1 (0205), #785 (0206).
No merge or deployment is authorized. Build above
`origin/T3-CODE/business-commission-plan-employees-api` at
`1f8f9c4c49f2bf811ed7a3c3e76a3d07c6335132`; this branch was merged locally with
no rebase or force-push.

`pnpm db:generate package-redemption-storage` produced one 0205 snapshot and
journal entry. The generated SQL was replaced with the reviewed candidate bytes;
Node Buffer comparison passes and SHA256 remains
`AA22FB41D40A0344357004C64932C694235B1D0FD9CB96330349E3C8BB654D97`.
The 0205 snapshot's prevId equals the 0204 snapshot's id.

The normal Vitest configuration now tests the journalled migration directly,
without the temporary candidate global setup. Candidate routing files are retired;
their commands in the earlier receipt describe historical runs only.
OpenAPI and both API clients were regenerated. Independent Astra high review
must complete all required reads, with bounded rereads of any truncated output.
Earlier incomplete review remains unapproved; internal review/fix counter is 1/5.

The owner also explicitly supersedes dependency sequencing: start 43-1b in this
same session immediately after storage push while its reviews run; open the
dependent PR only after storage merges. Keep the storage PR explicitly stacked
on #793 against main. After #793 merges, merge main without rebase/force-push and
verify the migration diff contains only 0205. The manager retains merge ownership.

Journalled 0205 verification: 188 DB tests in 14 files passed (95.98 seconds). Contracts/OpenAPI: 104 tests in 11 files passed (7.03 seconds). Scope relative to #793 head: authored 1625, generated 26983, combined 28608 additions plus deletions before this receipt update; all below approved caps.
