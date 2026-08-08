param(
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $repositoryRoot "release"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$package = Get-Content -Raw -Encoding UTF8 (Join-Path $repositoryRoot "package.json") | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Invalid package version: $version"
}

$folderName = "BulletBook_Windows_Android_v$version"
$stagingRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot ".release-staging"))
$expectedPrefix = $repositoryRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $stagingRoot.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe staging path: $stagingRoot"
}
$packageRoot = Join-Path $stagingRoot $folderName
$zipPath = Join-Path $OutputDirectory "BulletBook_windows_v$version.zip"
$files = @(
  "app.js",
  "cloud-sync.js",
  "favicon.svg",
  "index.html",
  "package.json",
  "README.md",
  "Start_BulletBook.bat",
  "styles.css",
  "VERSION.txt",
  "windows-host.mjs"
)

if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
try {
  foreach ($relativePath in $files) {
    $source = Join-Path $repositoryRoot $relativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "Required Windows package file is missing: $relativePath"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $packageRoot $relativePath)
  }
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Output $zipPath
} finally {
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
}