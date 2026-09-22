# Spec Kit — project-local changes

Spec Kit 1.0.9 ships defaults that conflict with this repository's rules. These are the local
changes, so that a `specify` refresh can be checked against them.

| What | Where | Why |
|---|---|---|
| Specs are created under `docs/specs/NNN-<module>-<use-case>/`, not `specs/` | `scripts/powershell/create-new-feature.ps1` (line with `'docs/specs'`), `speckit-specify` skills, `templates/overrides/plan-template.md` | `CLAUDE.md` §1 requires the slice spec under `docs/specs/` |
| Test tasks are mandatory, never optional | `speckit-tasks` skills, `templates/overrides/tasks-template.md` | `CLAUDE.md` §9 — tests are required to merge |

## After a Spec Kit refresh

- `templates/overrides/` is Spec Kit's own project layer and survives a refresh untouched.
- The script and the `speckit-*` skills in `.claude/`, `.github/` and `.agents/` **are** regenerated.
  Re-apply the two rows above, then run:
  `Select-String -Path .specify\scripts\powershell\*.ps1, .claude\skills\speckit-*\SKILL.md -Pattern "'specs'|Tests are OPTIONAL"` — it must return nothing.

## Naming a feature

Give `/speckit-specify` a short name of the form `<module>-<use-case>`, e.g. `tenancy-create-company`.
The folder becomes `docs/specs/001-tenancy-create-company/` with `spec.md`, `plan.md`, `tasks.md`.
