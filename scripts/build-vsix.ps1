param(
    [string]$TargetRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "extension"),
    [string]$OutputFolder = (Join-Path (Split-Path -Parent $PSScriptRoot) "artifacts"),
    [string]$VsceVersion = "3.9.1"
)

$ErrorActionPreference = "Stop"

function Assert-ExitCode([string]$Operation) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE."
    }
}

$TargetRoot = [IO.Path]::GetFullPath($TargetRoot)
$OutputFolder = [IO.Path]::GetFullPath($OutputFolder)

if (-not (Test-Path (Join-Path $TargetRoot "package.json"))) {
    throw "Extension source was not found: $TargetRoot"
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
if (-not $node) { throw "Node.js was not found in PATH." }

$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npx) { throw "npx.cmd was not found in PATH." }

New-Item -ItemType Directory -Force -Path $OutputFolder | Out-Null

$package = Get-Content (Join-Path $TargetRoot "package.json") -Raw | ConvertFrom-Json
$vsix = Join-Path $OutputFolder "$($package.name)-$($package.version).vsix"

Set-Location $TargetRoot

$tsc = Join-Path $TargetRoot "node_modules\typescript\bin\tsc"
if (-not (Test-Path $tsc)) {
    throw "TypeScript is missing. Run npm install in the extension folder first."
}

& $node.Source $tsc -p .
Assert-ExitCode "TypeScript compilation"

$required = @(
    "dist\extension.js",
    "dist\retrievalClient.js",
    "media\knowledge\knowledge.jsonl",
    "media\knowledge\manifest.json",
    "media\mermaid.min.js",
    "media\marked.min.js"
)

foreach ($relative in $required) {
    if (-not (Test-Path (Join-Path $TargetRoot $relative))) {
        throw "Required file is missing: $relative"
    }
}

Remove-Item $vsix -Force -ErrorAction SilentlyContinue

& $npx.Source --yes "@vscode/vsce@$VsceVersion" package --no-dependencies --out $vsix
Assert-ExitCode "VSIX packaging"

Write-Host ""
Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "VSIX: $vsix"
Write-Host "SHA256: $((Get-FileHash $vsix -Algorithm SHA256).Hash.ToLowerInvariant())"
Write-Host "Installation was intentionally not performed."
