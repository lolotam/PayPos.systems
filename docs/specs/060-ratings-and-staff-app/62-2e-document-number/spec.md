# 62-2e Employee document number

A manager can enter an optional number while uploading or replacing an employee document. Existing documents work with a null number. A replacement gets the submitted number or null. [DN-Q1](../owner-questions.ar.md) covers in-place editing separately.

- The input accepts an omitted field, null or trimmed text of 1–64 Unicode code points. Raw control characters and unpaired surrogates are rejected.
- The employee document list returns the number to an authorized reader. A business-scoped lookup supplies numbers for visible document expiry notifications after a fresh check of `read:files:business`. A refusal or missing result leaves the existing notification text visible.
- Numbers are excluded from upload responses, notifications and their safe parameters, events, logs, audit entries and stored idempotency responses.
- The additive migrations store the number on the existing tenant table and validate its constraint without backfilling existing rows.

The acceptance criteria in [the original delivery spec](https://github.com/lolotam/PayPos.systems/tree/67499fe0e108006f231c7deb301a16fdc154ae2c/docs/specs/060-ratings-and-staff-app/61-2a-62-2e/spec.md) apply to 62-2e. See the [implementation plan](plan.md) for verification and rollout.
