param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [int]$ExpectedPdfCount = 12,
    [int]$ExpectedKnowledgeRecords = 55,
    [switch]$ForceEnrichment,
    [switch]$SkipPythonDependencyInstall,
    [switch]$SkipNodeDependencyInstall,
    [switch]$InstallVsix
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param(
        [int]$Number,
        [string]$Title
    )

    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    Write-Host ("STEP {0}: {1}" -f $Number, $Title) -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
}

function Assert-LastExitCode {
    param([string]$Operation)

    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE."
    }
}

function Get-CommandPath {
    param(
        [string[]]$Names,
        [string]$FriendlyName
    )

    foreach ($Name in $Names) {
        $Command = Get-Command $Name -ErrorAction SilentlyContinue
        if ($Command) {
            return $Command.Source
        }
    }

    throw "$FriendlyName was not found in PATH."
}

function Get-JsonlCount {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "JSONL file was not found: $Path"
    }

    return @(
        Get-Content -LiteralPath $Path -Encoding UTF8 |
            Where-Object { $_.Trim() }
    ).Count
}

function Test-Jsonl {
    param([string]$Path)

    $Count = 0
    $LineNumber = 0

    Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
        $LineNumber++

        if ($_.Trim()) {
            try {
                $null = $_ | ConvertFrom-Json
                $Count++
            }
            catch {
                throw "Invalid JSON at $Path line $LineNumber. $($_.Exception.Message)"
            }
        }
    }

    return $Count
}

$RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
$PipelineRoot = Join-Path $RepoRoot "knowledge-pipeline"
$ExtensionRoot = Join-Path $RepoRoot "extension"
$ScriptsRoot = Join-Path $RepoRoot "scripts"

$RequiredFiles = @(
    (Join-Path $PipelineRoot "download_source_pdfs.ps1"),
    (Join-Path $PipelineRoot "run_01_pdf_enrichment.ps1"),
    (Join-Path $PipelineRoot "run_02_build_knowledge.ps1"),
    (Join-Path $PipelineRoot "requirements.txt"),
    (Join-Path $PipelineRoot "config.json"),
    (Join-Path $ScriptsRoot "replace-knowledge-pack.ps1"),
    (Join-Path $ScriptsRoot "test-repository.ps1"),
    (Join-Path $ExtensionRoot "package.json")
)

Write-Host ""
Write-Host "PDF Knowledge Studio - Complete Build and Test" -ForegroundColor Green
Write-Host "Repository: $RepoRoot"
Write-Host ""

Write-Step 1 "Preflight checks"

if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
    throw "Repository folder was not found: $RepoRoot"
}

foreach ($RequiredFile in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath $RequiredFile -PathType Leaf)) {
        throw "Required file was not found: $RequiredFile"
    }
}

$NodePath = Get-CommandPath -Names @("node.exe", "node") -FriendlyName "Node.js"
$NpmPath = Get-CommandPath -Names @("npm.cmd", "npm") -FriendlyName "npm"
$NpxPath = Get-CommandPath -Names @("npx.cmd", "npx") -FriendlyName "npx"
$GitPath = Get-CommandPath -Names @("git.exe", "git") -FriendlyName "Git"
$CodePath = Get-CommandPath -Names @("code.cmd", "code") -FriendlyName "Visual Studio Code CLI"

$PyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
if (-not $PyLauncher) {
    $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
}

Write-Host "Node : $(& $NodePath --version)"
Write-Host "npm  : $(& $NpmPath --version)"
Write-Host "npx  : $(& $NpxPath --version)"
Write-Host "Git  : $(& $GitPath --version)"
Write-Host "Code : $((& $CodePath --version | Select-Object -First 1))"

Write-Step 2 "Prepare Python environment"

$VenvPython = Join-Path $PipelineRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
    if (-not $PyLauncher) {
        throw "Python launcher 'py' was not found and the virtual environment does not exist."
    }

    Push-Location $PipelineRoot
    try {
        & $PyLauncher.Source -3.12 -m venv .venv
        Assert-LastExitCode "Python virtual environment creation"
    }
    finally {
        Pop-Location
    }
}

Write-Host "Python: $(& $VenvPython --version)"

if (-not $SkipPythonDependencyInstall) {
    & $VenvPython -m pip install --upgrade pip
    Assert-LastExitCode "pip upgrade"

    & $VenvPython -m pip install -r (Join-Path $PipelineRoot "requirements.txt")
    Assert-LastExitCode "Python dependency installation"
}
else {
    Write-Host "Python dependency installation skipped."
}

& $VenvPython -c "import pypdf, openai, dotenv; print('Python pipeline dependencies ready')"
Assert-LastExitCode "Python dependency verification"

Write-Step 3 "Validate Azure OpenAI configuration"

$EnvFile = Join-Path $PipelineRoot ".env"

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw @"
Azure OpenAI .env file was not found:

$EnvFile

Copy .env.example to .env and configure the endpoint, key, deployment,
mode, and API version before running this workflow.
"@
}

$EnvText = Get-Content -LiteralPath $EnvFile -Raw -Encoding UTF8

$RequiredEnvNames = @(
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_DEPLOYMENT"
)

foreach ($EnvName in $RequiredEnvNames) {
    $Match = [regex]::Match(
        $EnvText,
        "(?m)^\s*" + [regex]::Escape($EnvName) + "\s*=\s*(.+?)\s*$"
    )

    if (-not $Match.Success -or -not $Match.Groups[1].Value.Trim()) {
        throw "Missing or empty setting in .env: $EnvName"
    }

    $Value = $Match.Groups[1].Value.Trim()

    if ($Value -match "YOUR-|PASTE-|REPLACE-|<.*>") {
        throw "Placeholder value remains in .env for $EnvName"
    }
}

Write-Host "Azure configuration file found and required settings are populated."
Write-Host "The API key value was not displayed."

Write-Step 4 "Download and verify source PDFs"

Push-Location $PipelineRoot
try {
    & ".\download_source_pdfs.ps1"
}
finally {
    Pop-Location
}

$PdfFolder = Join-Path $PipelineRoot "KnowledgeSource\NIST_CSF_2_0_Knowledge_Base\pdfs"
$PdfFiles = @(
    Get-ChildItem -LiteralPath $PdfFolder -Filter "*.pdf" -File -ErrorAction Stop
)

Write-Host "PDF files found: $($PdfFiles.Count)"

if ($ExpectedPdfCount -gt 0 -and $PdfFiles.Count -ne $ExpectedPdfCount) {
    throw "Expected $ExpectedPdfCount PDFs but found $($PdfFiles.Count)."
}

Write-Step 5 "Extract and Azure-enrich all PDFs"

$EnrichmentArguments = @()

if ($ForceEnrichment) {
    $EnrichmentArguments += "-Force"
    Write-Host "Force enrichment is enabled. Existing caches may be rebuilt." -ForegroundColor Yellow
}
else {
    Write-Host "Resume mode is enabled. Completed chunks will be reused."
}

Push-Location $PipelineRoot
try {
    & ".\run_01_pdf_enrichment.ps1" @EnrichmentArguments
}
finally {
    Pop-Location
}

$EnrichmentReportPath = Join-Path $PipelineRoot "out\reports\pdf_enrichment_report.json"

if (-not (Test-Path -LiteralPath $EnrichmentReportPath -PathType Leaf)) {
    throw "Enrichment report was not created: $EnrichmentReportPath"
}

$EnrichmentReport = Get-Content -LiteralPath $EnrichmentReportPath -Raw -Encoding UTF8 | ConvertFrom-Json

Write-Host "Documents found     : $($EnrichmentReport.documents_found)"
Write-Host "Documents processed : $($EnrichmentReport.documents_processed)"
Write-Host "Documents skipped   : $($EnrichmentReport.documents_skipped)"
Write-Host "Documents failed    : $($EnrichmentReport.documents_failed)"
Write-Host "Chunks created      : $($EnrichmentReport.chunks_created)"
Write-Host "Chunks enriched     : $($EnrichmentReport.chunks_enriched)"
Write-Host "Chunks reused       : $($EnrichmentReport.chunks_reused)"

if ([int]$EnrichmentReport.documents_failed -ne 0) {
    throw "One or more documents failed enrichment."
}

Write-Step 6 "Merge enriched documents into knowledge.jsonl"

Push-Location $PipelineRoot
try {
    & ".\run_02_build_knowledge.ps1"
}
finally {
    Pop-Location
}

$KnowledgeOutputRoot = Join-Path $PipelineRoot "out\04_knowledge_base"
$KnowledgeFile = Join-Path $KnowledgeOutputRoot "knowledge.jsonl"

$KnowledgeRecordCount = Test-Jsonl -Path $KnowledgeFile
Write-Host "Valid generated knowledge records: $KnowledgeRecordCount"

if ($ExpectedKnowledgeRecords -gt 0 -and $KnowledgeRecordCount -ne $ExpectedKnowledgeRecords) {
    throw "Expected $ExpectedKnowledgeRecords knowledge records but found $KnowledgeRecordCount."
}

$ExpectedKnowledgeOutputs = @(
    "knowledge.jsonl",
    "document_catalog.jsonl",
    "relationships.jsonl",
    "generation_quality_report.json",
    "knowledge_manifest.json"
)

foreach ($OutputName in $ExpectedKnowledgeOutputs) {
    $OutputPath = Join-Path $KnowledgeOutputRoot $OutputName

    if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
        throw "Expected knowledge output was not created: $OutputPath"
    }
}

Write-Step 7 "Validate generated knowledge quality"

$Records = @(
    Get-Content -LiteralPath $KnowledgeFile -Encoding UTF8 |
        Where-Object { $_.Trim() } |
        ForEach-Object { $_ | ConvertFrom-Json }
)

$MissingSource = @(
    $Records |
        Where-Object {
            -not $_.source.file_name -or
            $null -eq $_.source.page_start -or
            $null -eq $_.source.page_end
        }
)

$DuplicateIds = @(
    $Records |
        Group-Object id |
        Where-Object Count -gt 1
)

$PlaceholderMatches = @(
    Select-String `
        -LiteralPath $KnowledgeFile `
        -Pattern "local-placeholder|no-llm" `
        -CaseSensitive:$false
)

$SourceDocuments = @(
    $Records |
        Group-Object { $_.source.file_name }
)

Write-Host "Missing source metadata : $($MissingSource.Count)"
Write-Host "Duplicate record IDs    : $($DuplicateIds.Count)"
Write-Host "Placeholder matches     : $($PlaceholderMatches.Count)"
Write-Host "Source documents        : $($SourceDocuments.Count)"

if ($MissingSource.Count -ne 0) {
    throw "One or more knowledge records are missing source metadata."
}

if ($DuplicateIds.Count -ne 0) {
    throw "Duplicate knowledge record IDs were found."
}

if ($PlaceholderMatches.Count -ne 0) {
    throw "Local placeholder records were found in the final knowledge file."
}

if ($ExpectedPdfCount -gt 0 -and $SourceDocuments.Count -ne $ExpectedPdfCount) {
    throw "Expected knowledge coverage for $ExpectedPdfCount source documents but found $($SourceDocuments.Count)."
}

$SourceDocuments |
    Sort-Object Name |
    Select-Object Name, Count |
    Format-Table -AutoSize

Write-Step 8 "Install generated knowledge into the extension"

& (Join-Path $ScriptsRoot "replace-knowledge-pack.ps1") `
    -KnowledgeFile $KnowledgeFile

$InstalledKnowledgeFile = Join-Path $ExtensionRoot "media\knowledge\knowledge.jsonl"
$InstalledManifestPath = Join-Path $ExtensionRoot "media\knowledge\manifest.json"

$InstalledCount = Test-Jsonl -Path $InstalledKnowledgeFile
$InstalledManifest = Get-Content -LiteralPath $InstalledManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$InstalledSha = (Get-FileHash -LiteralPath $InstalledKnowledgeFile -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "Installed JSONL records : $InstalledCount"
Write-Host "Manifest record count   : $($InstalledManifest.recordCount)"
Write-Host "Installed SHA256        : $InstalledSha"
Write-Host "Manifest SHA256         : $($InstalledManifest.sha256)"

if ($InstalledCount -ne [int]$InstalledManifest.recordCount) {
    throw "Installed knowledge count does not match manifest count."
}

if ($InstalledManifest.sha256 -and $InstalledSha -ne $InstalledManifest.sha256.ToLowerInvariant()) {
    throw "Installed knowledge SHA256 does not match manifest."
}

Write-Step 9 "Install Node dependencies"

if (-not $SkipNodeDependencyInstall) {
    Push-Location $ExtensionRoot
    try {
        if (Test-Path -LiteralPath (Join-Path $ExtensionRoot "package-lock.json") -PathType Leaf) {
            & $NpmPath ci `
                --registry=https://registry.npmjs.org/ `
                --no-audit `
                --no-fund
        }
        else {
            & $NpmPath install `
                --registry=https://registry.npmjs.org/ `
                --no-audit `
                --no-fund
        }

        Assert-LastExitCode "Node dependency installation"
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "Node dependency installation skipped."
}

$TypeScriptCompiler = Join-Path $ExtensionRoot "node_modules\typescript\bin\tsc"

if (-not (Test-Path -LiteralPath $TypeScriptCompiler -PathType Leaf)) {
    throw "TypeScript compiler was not found after dependency preparation."
}

Write-Step 10 "Run publication scan, compile, and package VSIX"

& (Join-Path $ScriptsRoot "test-repository.ps1") -SkipNpmInstall

$ArtifactsRoot = Join-Path $RepoRoot "artifacts"
$Vsix = Get-ChildItem `
    -LiteralPath $ArtifactsRoot `
    -Filter "*.vsix" `
    -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $Vsix) {
    throw "No VSIX was found in $ArtifactsRoot"
}

$VsixSha = (Get-FileHash -LiteralPath $Vsix.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host ""
Write-Host "VSIX created:" -ForegroundColor Green
Write-Host "  $($Vsix.FullName)"
Write-Host "SHA256:"
Write-Host "  $VsixSha"

Write-Step 11 "Optional local VSIX installation"

if ($InstallVsix) {
    & $CodePath --install-extension $Vsix.FullName --force
    Assert-LastExitCode "VSIX installation"

    Write-Host "VSIX installed locally." -ForegroundColor Green
    Write-Host "Reload VS Code before testing the commands."
}
else {
    Write-Host "Local installation skipped."
    Write-Host "Install later with:"
    Write-Host "  code --install-extension `"$($Vsix.FullName)`" --force"
}

Write-Step 12 "Completion summary"

Write-Host "Source PDFs             : $($PdfFiles.Count)"
Write-Host "Generated records       : $KnowledgeRecordCount"
Write-Host "Installed records       : $InstalledCount"
Write-Host "Source-document coverage: $($SourceDocuments.Count)"
Write-Host "VSIX                    : $($Vsix.FullName)"
Write-Host "VSIX SHA256             : $VsixSha"
Write-Host ""
Write-Host "SUCCESS: complete PDF Knowledge Studio build and test passed." -ForegroundColor Green
Write-Host ""
Write-Host "Next manual smoke tests:"
Write-Host "  1. PDF Knowledge: Configure Azure OpenAI"
Write-Host "  2. PDF Knowledge: Test Local Knowledge and Azure OpenAI"
Write-Host "  3. Test @pdf-knowledge in Fast and Deep modes"
Write-Host "  4. Test Document Builder"
Write-Host "  5. Test Knowledge Explorer"
Write-Host ""
Write-Host "This script packages a VSIX. It does not publish to the Visual Studio Marketplace."
