pnpm --filter @pospay/api typecheck 2>&1 | Select-String -Pattern 'error TS' | Select-Object -First 6 | Out-String -Width 220
Write-Output "TS=$LASTEXITCODE"
pnpm --filter @pospay/api lint 2>&1 | Select-String -Pattern '  error|problems' | Select-Object -Last 2 | Out-String -Width 220
Write-Output "L=$LASTEXITCODE"
pnpm --filter @pospay/worker typecheck 2>&1 | Select-String -Pattern 'error TS' | Select-Object -First 4 | Out-String -Width 220
Write-Output "TSW=$LASTEXITCODE"
pnpm --filter @pospay/admin typecheck 2>&1 | Select-String -Pattern 'error TS' | Select-Object -First 4 | Out-String -Width 220
Write-Output "TSA=$LASTEXITCODE"
pnpm --filter @pospay/api exec vitest run --config vitest.unit.config.ts 2>&1 | Select-String -Pattern 'Test Files|Tests |FAIL' | Select-Object -First 4
Write-Output "UNIT=$LASTEXITCODE"
