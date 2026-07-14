param(
    [string]$InputFolder = (Join-Path $PSScriptRoot "out\03_enriched_chunks\by_document"),
    [string]$OutputFolder = (Join-Path $PSScriptRoot "out\04_knowledge_base"),
    [string]$ConfigFile = (Join-Path $PSScriptRoot "config.json"),
    [switch]$AllowLocalPlaceholder
)

$ErrorActionPreference = "Stop"

$Python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$Builder = Join-Path $PSScriptRoot "02_build_knowledge_base.py"

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Python virtual environment not found: $Python"
}

if (-not (Test-Path -LiteralPath $Builder -PathType Leaf)) {
    throw "Knowledge builder was not found: $Builder"
}

if (-not (Test-Path -LiteralPath $InputFolder -PathType Container)) {
    throw "Enriched input folder was not found: $InputFolder"
}

if (-not (Test-Path -LiteralPath $ConfigFile -PathType Leaf)) {
    throw "Pipeline configuration was not found: $ConfigFile"
}

$PythonArguments = @(
    $Builder
    "--input"
    [IO.Path]::GetFullPath($InputFolder)
    "--out"
    [IO.Path]::GetFullPath($OutputFolder)
    "--config"
    [IO.Path]::GetFullPath($ConfigFile)
)

if ($AllowLocalPlaceholder) {
    $PythonArguments += "--allow-local-placeholder"
}

Write-Host "Building retriever-ready knowledge base..." -ForegroundColor Cyan
Write-Host "Input : $([IO.Path]::GetFullPath($InputFolder))"
Write-Host "Output: $([IO.Path]::GetFullPath($OutputFolder))"
Write-Host ""

& $Python @PythonArguments

if ($LASTEXITCODE -ne 0) {
    throw "Knowledge-base build failed with exit code $LASTEXITCODE."
}

$KnowledgeFile = Join-Path $OutputFolder "knowledge.jsonl"

if (-not (Test-Path -LiteralPath $KnowledgeFile -PathType Leaf)) {
    throw "Build completed without creating knowledge.jsonl: $KnowledgeFile"
}

$RecordCount = @(
    Get-Content -LiteralPath $KnowledgeFile -Encoding UTF8 |
        Where-Object { $_.Trim() }
).Count

Write-Host ""
Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "Knowledge file: $KnowledgeFile"
Write-Host "Records       : $RecordCount"
