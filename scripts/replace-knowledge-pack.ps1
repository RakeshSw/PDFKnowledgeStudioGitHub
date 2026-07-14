param(
    [Parameter(Mandatory = $true)]
    [string]$KnowledgeFile,

    [string]$ExtensionRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "extension")
)

$ErrorActionPreference = "Stop"

$KnowledgeFile = [IO.Path]::GetFullPath($KnowledgeFile)
$ExtensionRoot = [IO.Path]::GetFullPath($ExtensionRoot)

if (-not (Test-Path $KnowledgeFile -PathType Leaf)) {
    throw "Knowledge file was not found: $KnowledgeFile"
}

$count = 0
Get-Content $KnowledgeFile -Encoding UTF8 | ForEach-Object {
    if ($_.Trim()) {
        $null = $_ | ConvertFrom-Json
        $count++
    }
}

if ($count -lt 1) {
    throw "The knowledge file contains no valid records."
}

$folder = Join-Path $ExtensionRoot "media\knowledge"
New-Item -ItemType Directory -Force -Path $folder | Out-Null

$destination = Join-Path $folder "knowledge.jsonl"
Copy-Item $KnowledgeFile $destination -Force

$sha = (Get-FileHash $destination -Algorithm SHA256).Hash.ToLowerInvariant()

$manifest = [ordered]@{
    schemaVersion = "1.0"
    knowledgeVersion = "nist-csf-2.0-public-demo"
    retrievalVersion = "4.4.0-local"
    recordCount = $count
    sha256 = $sha
    description = "Bundled public NIST CSF demonstration knowledge pack."
}

$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText(
    (Join-Path $folder "manifest.json"),
    ($manifest | ConvertTo-Json -Depth 10),
    $utf8
)

Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "Records: $count"
Write-Host "SHA256: $sha"
