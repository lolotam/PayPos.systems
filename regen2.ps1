Remove-Item rb.ps1 -ErrorAction SilentlyContinue
pnpm --filter @pospay/domain build 2>&1 | Select-Object -Last 1
pnpm --filter @pospay/db build 2>&1 | Select-Object -Last 1
pnpm --filter @pospay/i18n build 2>&1 | Select-Object -Last 1
pnpm --filter @pospay/contracts build 2>&1 | Select-Object -Last 1
pnpm contracts:openapi 2>&1 | Select-Object -Last 1
pnpm --filter @pospay/admin api:generate 2>&1 | Select-Object -Last 1
pnpm --filter @pospay/pos api:generate 2>&1 | Select-Object -Last 1
pnpm --filter @pospay/menu api:generate 2>&1 | Select-Object -Last 1
git status --porcelain | Out-String -Width 180
pnpm --filter @pospay/api typecheck 2>&1 | Select-String -Pattern 'error TS' | Select-Object -First 6 | Out-String -Width 220
Write-Output "TS=$LASTEXITCODE"
pnpm --filter @pospay/worker typecheck 2>&1 | Select-String -Pattern 'error TS' | Select-Object -First 4 | Out-String -Width 220
Write-Output "TSW=$LASTEXITCODE"
pnpm --filter @pospay/api lint 2>&1 | Select-String -Pattern '  error|problems' | Select-Object -Last 2 | Out-String -Width 220
Write-Output "L=$LASTEXITCODE"
pnpm --filter @pospay/worker lint 2>&1 | Select-String -Pattern '  error|problems' | Select-Object -Last 2 | Out-String -Width 220
Write-Output "LW=$LASTEXITCODE"
