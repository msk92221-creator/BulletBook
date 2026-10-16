param([switch]$Publish)
$ErrorActionPreference='Stop'
Set-Location ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
function Run([string]$Program,[string[]]$Arguments) {
  & $Program @Arguments
  if($LASTEXITCODE -ne 0){throw "$Program failed ($LASTEXITCODE). Release was not published."}
}
$package=Get-Content -Raw package.json | ConvertFrom-Json
$version=$package.version
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid release version'}
$keyDirectory=$env:BULLETBOOK_KEYSTORE_DIR
if(-not $keyDirectory){$keyDirectory=Join-Path $env:USERPROFILE 'bulletbook-release-signing'}
foreach($name in @('bulletbook-release.jks','keystore.properties')) {
  if(-not (Test-Path -LiteralPath (Join-Path $keyDirectory $name))){throw "Existing release signing file is required: $name. Run on the computer that built 0.42.3."}
}
$env:BULLETBOOK_KEYSTORE_DIR=$keyDirectory
$sdk=$env:ANDROID_HOME
if(-not $sdk){$sdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'}
$tools=Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$apksigner=Join-Path $tools.FullName 'apksigner.bat'
$aapt=Join-Path $tools.FullName 'aapt.exe'
if(-not (Test-Path $apksigner)){throw 'Install Android SDK build-tools first.'}
if($Publish){Run 'gh' @('auth','status')}
$worktreeState=& git status --porcelain --untracked-files=all
if($LASTEXITCODE -ne 0 -or $worktreeState){throw 'Commit or move local changes and untracked files before creating a public release.'}
$commit=(& git rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0){throw 'Cannot determine source commit'}
Run 'npm.cmd' @('ci')
Run 'npm.cmd' @('run','test:inbox')
Run 'npm.cmd' @('run','test:sync')
Run 'npm.cmd' @('run','test:windows-host')
Run 'npm.cmd' @('run','test:category-colors')
Run 'npm.cmd' @('run','test:day-agenda')
Run 'npm.cmd' @('run','test:family')
Run 'npm.cmd' @('run','test:family-connection')
Run 'npm.cmd' @('run','test:widget-snapshot')
Run 'npm.cmd' @('run','test:widget-startup')
Run 'npm.cmd' @('run','build:web')
# cap sync rewrites this path; keep the checked-in patched runtime used by 0.42.3.
$settings=Get-Content -Raw android/capacitor.settings.gradle
try {Run 'node' @('node_modules/@capacitor/cli/bin/capacitor','sync','android')}
finally {[IO.File]::WriteAllText((Join-Path (Get-Location) 'android/capacitor.settings.gradle'),$settings,(New-Object Text.UTF8Encoding $false))}
Push-Location android
try {Run '.\gradlew.bat' @(':app:testDebugUnitTest',':app:assembleRelease','--no-daemon','--console=plain')}
finally {Pop-Location}
$built='android/app/build/outputs/apk/release/app-release.apk'
if(-not(Test-Path $built)){throw 'Signed release APK was not produced.'}
$certLines=& $apksigner verify --print-certs $built
if($LASTEXITCODE -ne 0){throw 'APK signature verification failed.'}
$cert=($certLines | Select-String 'certificate SHA-256 digest:').Line
if(-not $cert){throw 'Cannot read APK signer'}
$releaseDir=Join-Path (Get-Location) 'release'
New-Item -ItemType Directory -Force $releaseDir | Out-Null
$previous=Join-Path $releaseDir 'BulletBook_previous_0.42.3.apk'
# Public APK contains only the certificate, never the private signing key.
if(-not(Test-Path $previous)) {
  Invoke-WebRequest 'https://github.com/msk92221-creator/BulletBook/releases/download/v0.42.3/BulletBook_v0.42.3.apk' -OutFile $previous
}
$oldLines=& $apksigner verify --print-certs $previous
if($LASTEXITCODE -ne 0){throw 'Previous APK verification failed.'}
$oldCert=($oldLines | Select-String 'certificate SHA-256 digest:').Line
if(($cert -join "`n") -ne ($oldCert -join "`n")){throw 'Signing key differs from the installed app. Release was not published.'}
$badging=& $aapt dump badging $built
if($LASTEXITCODE -ne 0){throw 'Cannot read APK metadata'}
if(($badging -join "`n") -notmatch "package: name='kr.co.bulletbook.next' versionCode='113' versionName='0.43.0'"){throw 'APK ID or version does not match this release.'}
$apk=Join-Path $releaseDir "BulletBook_v$version.apk"
Copy-Item -LiteralPath $built -Destination $apk -Force
& (Join-Path $PSScriptRoot 'package-windows.ps1')
$windows=Join-Path $releaseDir "BulletBook_windows_v$version.zip"
if(-not(Test-Path $windows)){throw 'Windows package missing'}
$notes=Join-Path $releaseDir 'release-notes.txt'
@"
불렛북 상단에 날짜 없이 보관하는 ‘언젠가 할 일’ 체크리스트를 추가했습니다. 페이지를 바꿔도 표시되며, 완료·다시 열기·수정·삭제 취소와 접기/펼치기를 지원합니다. 불렛북 백업과 기존 OneDrive 동기화에 포함됩니다.

기존 0.42.3 APK와 동일한 서명, 앱 ID를 검증했습니다. 기존 앱의 업데이트 확인으로 설치하며 삭제할 필요가 없습니다.
Source: $commit
"@ | Set-Content -LiteralPath $notes -Encoding UTF8
if(-not $Publish){Write-Host "Verified APK ready: $apk. Re-run with -Publish to publish.";exit 0}
$repo='msk92221-creator/BulletBook'
$currentTag=& gh api "repos/$repo/releases/latest" --jq '.tag_name'
if($LASTEXITCODE -ne 0 -or $currentTag.Trim() -ne 'v0.42.3') {
  throw 'The latest release changed. Check its version before publishing this update.'
}
# Upload into a draft first so the phone cannot see a release without its complete APK.
Run 'gh' @('release','create',"v$version",$apk,$windows,'--repo',$repo,'--target',$commit,'--title',"BulletBook $version",'--notes-file',$notes,'--draft')
Run 'gh' @('release','edit',"v$version",'--repo',$repo,'--draft=false','--latest')
$latest=& gh api "repos/$repo/releases/latest" --jq '.tag_name'
if($LASTEXITCODE -ne 0 -or $latest.Trim() -ne "v$version"){throw 'Could not verify latest release.'}
Write-Host "Published v$version. On your phone, tap 업데이트 확인."
