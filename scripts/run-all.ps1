param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$ForceEnrichment,
    [switch]$RefreshDependencies,
    [switch]$SkipVsixInstall
)

$ErrorActionPreference = "Stop"

$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$DownloadsRunner = Join-Path $env:USERPROFILE "Downloads\run_complete_pdf_knowledge_build.ps1"
$RepositoryRunner = Join-Path $PSScriptRoot "run_complete_pdf_knowledge_build.ps1"

if (Test-Path -LiteralPath $RepositoryRunner -PathType Leaf) {
    $Runner = $RepositoryRunner
}
elseif (Test-Path -LiteralPath $DownloadsRunner -PathType Leaf) {
    $Runner = $DownloadsRunner
}
else {
    throw @"
The complete build runner was not found.

Expected one of:
  $RepositoryRunner
  $DownloadsRunner
"@
}

$VenvPython = Join-Path $RepoRoot "knowledge-pipeline\.venv\Scripts\python.exe"
$TypeScriptCompiler = Join-Path $RepoRoot "extension\node_modules\typescript\bin\tsc"

$PythonReady = $false
if (Test-Path -LiteralPath $VenvPython -PathType Leaf) {
    & $VenvPython -c "import pypdf, openai, dotenv" 2>$null
    $PythonReady = ($LASTEXITCODE -eq 0)
}

$NodeReady = Test-Path -LiteralPath $TypeScriptCompiler -PathType Leaf

$RunnerArguments = @{
    RepoRoot = $RepoRoot
}

if (-not $SkipVsixInstall) {
    $RunnerArguments.InstallVsix = $true
}

if ($ForceEnrichment) {
    $RunnerArguments.ForceEnrichment = $true
}

if (-not $RefreshDependencies) {
    if ($PythonReady) {
        $RunnerArguments.SkipPythonDependencyInstall = $true
    }

    if ($NodeReady) {
        $RunnerArguments.SkipNodeDependencyInstall = $true
    }
}

Write-Host ""
Write-Host "PDF Knowledge Studio - One Shot" -ForegroundColor Green
Write-Host "Repository       : $RepoRoot"
Write-Host "Runner           : $Runner"
Write-Host "Python ready     : $PythonReady"
Write-Host "Node ready       : $NodeReady"
Write-Host "Force enrichment : $ForceEnrichment"
Write-Host "Refresh deps     : $RefreshDependencies"
Write-Host "Install VSIX     : $(-not $SkipVsixInstall)"
Write-Host ""

& $Runner @RunnerArguments

if ($LASTEXITCODE -ne 0) {
    throw "Complete build runner failed with exit code $LASTEXITCODE."
}
