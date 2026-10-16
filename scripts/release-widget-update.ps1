param([switch]$Publish)
$ErrorActionPreference = 'Stop'
Set-Location ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
if (-not $Publish) {
  Write-Output 'Release signing now runs in GitHub. Run npm run release:bump -- patch, add README release notes, commit and push to master.'
  Write-Output 'To retry a pushed release, run this script with -Publish or use GitHub Actions > Signed BulletBook release > Run workflow.'
  exit 0
}
gh workflow run release.yml --repo msk92221-creator/BulletBook --ref master
if ($LASTEXITCODE -ne 0) { throw 'Could not start the GitHub release workflow.' }
Write-Output 'Started GitHub release verification. Follow progress in Actions. No local signing key is needed.'
