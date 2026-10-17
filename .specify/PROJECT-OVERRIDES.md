# Spec Kit — project-local changes

Spec Kit 1.0.9 ships defaults that conflict with this repository's rules. These are the local
changes, so that a `specify` refresh can be checked against them.

| What | Where | Why |
|---|---|---|
| Specs are created under `docs/specs/NNN-<module>-<use-case>/`, not `specs/` | `scripts/powershell/create-new-feature.ps1` (line with `'docs/specs'`), `speckit-specify` skills, `templates/overrides/plan-template.md` | `CLAUDE.md` §1 requires the slice spec under `docs/specs/` |
| Business rules are never guessed; no cap on clarification markers | `speckit-specify` skills | `CLAUDE.md` §11 |
| Specs carry a mandatory **Slice design** section (schema, API contract, permissions, events, test plan) | `templates/overrides/spec-template.md`, `speckit-specify` checklist | `CLAUDE.md` §1 |
| Test tasks are mandatory, never optional | `speckit-tasks` skills, `templates/overrides/tasks-template.md` | `CLAUDE.md` §9 — tests are required to merge |
| `/speckit-implement` refuses to start while a business-rule checklist item is open (`checklists/requirements.md`, or any checklist item about money, permissions, tenant scope or business rules); a "yes" never overrides it. Other reviewer checklists keep the ask-to-proceed prompt | `speckit-implement` skills (`.claude`, `.github`, `.agents`) | `CLAUDE.md` §11 — business rules are never guessed |
| `/speckit-implement` runs `pnpm check` from the repo root, runs it again after the `after_implement` hooks whenever any hook ran, and does not report completion unless the last run exits 0 | `speckit-implement` skills (`.claude`, `.github`, `.agents`) | `CLAUDE.md` §1 — a slice is not done until `pnpm check` passes |

## Where the commands run

The spec-kit commands call `.specify/scripts/powershell/*.ps1`. They are run on Waleed's Windows machine,
where Windows PowerShell 5.1 executes them. They are **not** run in Codex's cloud environment: Codex is the
PR reviewer here, not a spec-kit executor, so no POSIX variant is shipped. If a Linux agent ever needs them,
install PowerShell 7 (`pwsh`) there or re-initialise spec-kit with `--script sh` — do not hand-port the scripts.

## After a Spec Kit refresh

- `templates/overrides/` is Spec Kit's own project layer and survives a refresh untouched.
- The script and the `speckit-*` skills in `.claude/`, `.github/` and `.agents/` **are** regenerated.
  Re-apply the rows above, then run:
  `Select-String -Path .specify\scripts\powershell\*.ps1, .claude\skills\speckit-*\SKILL.md -Pattern "'specs'|Tests are OPTIONAL"` — it must return nothing.
  `Select-String -Path .claude\skills\speckit-implement\SKILL.md, .github\skills\speckit-implement\SKILL.md, .agents\skills\speckit-implement\SKILL.md -Pattern "pnpm check", "this gate cannot be overridden", "Re-run the final gate after the hooks"` — each pattern must match in all three files. `-Pattern "If any checklist has unchecked items\*\*:"` on the same paths must return nothing (it is the old overridable prompt).

## Naming a feature

Give `/speckit-specify` a short name of the form `<module>-<use-case>`, e.g. `tenancy-create-company`.
The folder becomes `docs/specs/001-tenancy-create-company/` with `spec.md`, `plan.md`, `tasks.md`.
