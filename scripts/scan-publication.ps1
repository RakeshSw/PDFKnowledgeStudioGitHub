param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$Patterns = @(
    "osm-bridge",
    "gpt-4o-mini-bridge",
    "eurofins",
    "127\.0\.0\.1:8093",
    "pdf_retrieval_service",
    "RakeshSw/pdf-knowledge-studio",
    "knowledge-studio-ai-24514",
    "C:\\Users\\[^\\]+\\(?:OneDrive\\)?Documents\\sourcecode",
    "knowledge-pipeline[\\/]out-test-enrichment",
    "(?i)AZURE_OPENAI_API_KEY\s*=\s*(?!YOUR-|<|$)[A-Za-z0-9_\-]{20,}"
)

$AllowedExtensions = @(
    ".ts", ".js", ".json", ".jsonl", ".md", ".ps1", ".py",
    ".txt", ".xml", ".yml", ".yaml", ".html", ".css", ".csv"
)

$Files = Get-ChildItem -LiteralPath $Root -Recurse -File -Force |
    Where-Object {
        $_.FullName -notmatch "\\.git\\" -and
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.FullName -notmatch "\\.venv\\" -and
        $_.FullName -notmatch "\\knowledge-pipeline\\out(?:-|\\)" -and
        $_.FullName -notmatch "\\knowledge-pipeline\\KnowledgeSource\\" -and
        $_.FullName -notmatch "\\artifacts\\" -and
        $_.Name -ne "scan-publication.ps1" -and
        $_.Name -ne ".env.example" -and
        $AllowedExtensions -contains $_.Extension.ToLowerInvariant()
    }

$Hits = foreach ($Pattern in $Patterns) {
    $Files | Select-String -Pattern $Pattern -ErrorAction SilentlyContinue
}

if ($Hits) {
    $Hits |
        Sort-Object Path, LineNumber |
        Select-Object Path, LineNumber, Pattern, Line |
        Format-Table -Wrap -AutoSize

    Write-Host ""
    Write-Host "REVIEW REQUIRED: sensitive, personal, or obsolete references were found." -ForegroundColor Yellow
    exit 2
}

Write-Host "PASS: no configured sensitive, personal, or obsolete references were found." -ForegroundColor Green