git add -A
git commit --amend --no-edit | Select-Object -Last 1
Remove-Item gate.ps1, gate2.ps1, regen2.ps1 -ErrorAction SilentlyContinue
git status --porcelain | Measure-Object -Line | Select-Object -ExpandProperty Lines
$rp = 'pp32b23local7f3a9c4e'
$env:REDIS_URL = "redis://:${rp}@127.0.0.1:56480"
pnpm --filter @pospay/worker exec vitest run "src/modules/catalog/__tests__/service-import-commit.spec.ts" "src/modules/catalog/jobs/service-import-commit.processor.spec.ts" "src/modules/catalog/__tests__/service-import-wiring.spec.ts" 2>&1 | Select-String -Pattern 'Test Files|Tests |FAIL' | Select-Object -First 5
Write-Output "WORKER=$LASTEXITCODE"
pnpm --filter @pospay/worker exec vitest run "src/modules/orders/jobs/package-import-commit.processor.spec.ts" "src/modules/orders/jobs/package-preview.processor.spec.ts" 2>&1 | Select-String -Pattern 'Test Files|Tests ' | Select-Object -First 3
Write-Output "PACKAGE=$LASTEXITCODE"
pnpm --filter @pospay/api exec vitest run --config vitest.config.ts "src/modules/catalog/__tests__/service-import-performance.spec.ts" --reporter=verbose 2>&1 | Select-String -Pattern 'budget_ms|Tests ' | Select-Object -First 3
Write-Output "PERF=$LASTEXITCODE"
git rev-parse HEAD
