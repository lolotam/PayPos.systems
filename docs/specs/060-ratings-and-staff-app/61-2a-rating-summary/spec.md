# 61-2a Staff rating summary API

The staff app can read the signed-in employee's average and count for the current calendar month in the business timezone. This slice implements the API described by [spec 060](../spec.md) and its use by the staff app is scheduled for 61-3.

- The personal staff session determines the company, business and caller. The same tenant transaction verifies the business, employee, membership, customers feature and `read:ratings:own`. A caller cannot supply a subject.
- `GET /v1/staff/me/rating-summary` returns `{ "visibility": "HIDDEN" }` when the staff column is disabled. When enabled, the response has `visibility: "VISIBLE"`, an average rounded to one decimal and a count. Zero ratings returns a null average and a zero count.
- The response excludes rating details and uses `Cache-Control: no-store` on success and error. An Admin or device session cannot call this route.
- The month filter applies to each rating's `submitted_at` in the business timezone, including when clocks move across a date boundary. The read first narrows the rows by an indexed UTC candidate window `[local_start - 1 day, local_start + 1 month + 1 day)` and then keeps only the rows whose business-local month is exactly `date_trunc('month', submitted_at AT TIME ZONE tz) = local_start`, so a daylight-saving fallback across midnight cannot split one month into two.

The acceptance criteria in [the original delivery spec](https://github.com/lolotam/PayPos.systems/tree/67499fe0e108006f231c7deb301a16fdc154ae2c/docs/specs/060-ratings-and-staff-app/61-2a-62-2e/spec.md) apply to 61-2a. See the [implementation plan](plan.md) for verification.
