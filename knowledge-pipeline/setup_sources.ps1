param(
    [Parameter(Mandatory = $true)]
    [string]$ZipPath,
    [string]$Destination = ".\KnowledgeSource"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force

Write-Host "PDF source pack extracted to: $Destination"
Write-Host "Default expected PDF folder:"
Write-Host "  $Destination\NIST_CSF_2_0_Knowledge_Base\pdfs"
