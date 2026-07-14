param(
    [string]$Source = ".\KnowledgeSource\NIST_CSF_2_0_Knowledge_Base\pdfs",
    [string]$Out = ".\out",
    [string]$Config = ".\config.json",
    [switch]$Force,
    [int]$Limit = 0,
    [switch]$NoLlm
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    throw "Python virtual environment not found. Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
}

$argsList = @(
    ".\01_pdf_to_enriched_chunks.py",
    "--source", $Source,
    "--out", $Out,
    "--config", $Config
)

if ($Force) { $argsList += "--force" }
if ($Limit -gt 0) { $argsList += @("--limit", "$Limit") }
if ($NoLlm) { $argsList += "--no-llm" }

& ".\.venv\Scripts\python.exe" @argsList
exit $LASTEXITCODE
