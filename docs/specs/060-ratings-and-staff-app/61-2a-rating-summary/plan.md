# 61-2a Staff rating summary implementation plan

1. Resolve own-read authority via the existing customers, tenancy, identity and staff boundaries. Check authority before the `rating_average` column gate.
2. Use `rating_attributions` from the same tenant transaction. Indexed UTC candidate bounds compare directly with `submitted_at`, and the local-month filter selects the exact rows from those candidates.
3. Register the route and the discriminated response contract. Regenerate OpenAPI and the Admin, Menu and POS clients. This slice adds no migration or new grant.
4. Verify authority, contract variants, month boundaries, rating isolation and use of the existing employee index. Run the tests with an isolated PostgreSQL lane.

```text
pnpm --filter @pospay/api exec vitest run --no-file-parallelism src/modules/customers/__tests__/own-rating-summary-http.spec.ts src/modules/customers/__tests__/own-rating-context.adapter.spec.ts src/modules/customers/queries/__tests__/own-rating-summary.query.spec.ts src/modules/identity/__tests__/own-ratings-access.spec.ts
pnpm --filter @pospay/contracts exec vitest run src/customers/own-rating-summary.spec.ts
```

[Original design and acceptance cases](https://github.com/lolotam/PayPos.systems/tree/67499fe0e108006f231c7deb301a16fdc154ae2c/docs/specs/060-ratings-and-staff-app/61-2a-62-2e/plan.md#3-row-61-2a--design).
