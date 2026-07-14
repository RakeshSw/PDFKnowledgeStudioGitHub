param(
    [string]$Destination = (Join-Path $PSScriptRoot "KnowledgeSource\NIST_CSF_2_0_Knowledge_Base\pdfs"),
    [switch]$Force
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Sources = @(
    [ordered]@{
        Order = 1
        File = "01_NIST_CSF_2.0_Core_Framework.pdf"
        Title = "The NIST Cybersecurity Framework (CSF) 2.0"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf"
        Sha256 = "3c31f46fee98cac0c4323453e5109291a213b4de7fef8c058af9bf67f717433c"
    },
    [ordered]@{
        Order = 2
        File = "02_CSF_2.0_Resource_and_Overview_Guide.pdf"
        Title = "NIST Cybersecurity Framework 2.0: Resource & Overview Guide"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1299.pdf"
        Sha256 = "5db59917d92013f06dfefdc62604230959ee34b93db1fd22de726f83d9345f09"
    },
    [ordered]@{
        Order = 3
        File = "03_Creating_and_Using_Organizational_Profiles.pdf"
        Title = "Quick-Start Guide for Creating and Using Organizational Profiles"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1301.pdf"
        Sha256 = "baf10ffc7ed7792a54e724b983a858b6c194c2ebcd21843034bee78a858f46d8"
    },
    [ordered]@{
        Order = 4
        File = "04_Creating_Community_Profiles.pdf"
        Title = "NIST CSF 2.0: A Guide to Creating Community Profiles"
        Status = "Initial Public Draft"
        Url = "https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.32.ipd.pdf"
        Sha256 = "492fbc7a93e48d6c05e2e7281558f59e737d6a25c9bba5c844c0656f3334bae0"
    },
    [ordered]@{
        Order = 5
        File = "05_Small_Business_Quick_Start_Guide.pdf"
        Title = "NIST Cybersecurity Framework 2.0: Small Business Quick-Start Guide"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1300.pdf"
        Sha256 = "1e77c1bd63d1e15c48c870b7c17b7c9a2edf6bd5103b0940e72828515c9f1881"
    },
    [ordered]@{
        Order = 6
        File = "06_Cybersecurity_Supply_Chain_Risk_Management.pdf"
        Title = "Quick-Start Guide for Cybersecurity Supply Chain Risk Management"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1305.pdf"
        Sha256 = "d81e11d9afe103a879d81556952913e45fa1022de3461014caa461579d3a6088"
    },
    [ordered]@{
        Order = 7
        File = "07_Using_the_CSF_Tiers.pdf"
        Title = "Quick-Start Guide for Using the CSF Tiers"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1302.pdf"
        Sha256 = "9e10b6f32781732fa24a28d0a986564f2c3f40f6d6af5d2b98cf38ee128b67f2"
    },
    [ordered]@{
        Order = 8
        File = "08_Enterprise_Risk_Management_Quick_Start_Guide.pdf"
        Title = "NIST Cybersecurity Framework 2.0: Enterprise Risk Management Quick-Start Guide"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1303.pdf"
        Sha256 = "f784be147e616e13720c8bf687a31f73800d52d2a0b1bb2a02be240b9f72082a"
    },
    [ordered]@{
        Order = 9
        File = "09_Cybersecurity_ERM_and_Workforce_Management.pdf"
        Title = "Cybersecurity, Enterprise Risk Management, and Workforce Management"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1308.pdf"
        Sha256 = "9efd9fbe1411dc8d7e69c490f6404ef5eef538d8d17f80171f386a7cf958b4c3"
    },
    [ordered]@{
        Order = 10
        File = "10_Informative_References_Quick_Start_Guide.pdf"
        Title = "NIST Cybersecurity Framework 2.0: Informative References Quick-Start Guide"
        Status = "Initial Public Draft"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1347.ipd.pdf"
        Sha256 = "16b1ae98dabaa62a2416fe3b107ffa97662b2ea394ea72e45687a499dd8ae028"
    },
    [ordered]@{
        Order = 11
        File = "11_Incident_Response_CSF_2.0_Community_Profile.pdf"
        Title = "Incident Response Recommendations and Considerations for Cybersecurity Risk Management"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r3.pdf"
        Sha256 = "e5593d6bb85daecec7e8d9549400c7b3473bcc3f06e469c82218073afa7fba2d"
    },
    [ordered]@{
        Order = 12
        File = "12_Ransomware_Risk_Management_CSF_2.0_Profile.pdf"
        Title = "Ransomware Risk Management: A CSF 2.0 Community Profile"
        Status = "Final"
        Url = "https://nvlpubs.nist.gov/nistpubs/ir/2026/NIST.IR.8374r1.pdf"
        Sha256 = "f32db66cfa000a8986b9c0f0b58b6e0f6bf825ce252b3b0c5757d75c0131fddf"
    }
)

New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$Downloaded = 0
$Reused = 0

foreach ($Source in $Sources) {
    $OutputPath = Join-Path $Destination $Source.File
    $ExpectedHash = $Source.Sha256.ToLowerInvariant()

    if ((Test-Path -LiteralPath $OutputPath -PathType Leaf) -and -not $Force) {
        $ExistingHash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($ExistingHash -eq $ExpectedHash) {
            Write-Host "REUSE  $($Source.File)"
            $Reused++
            continue
        }

        Write-Host "HASH MISMATCH: $($Source.File)" -ForegroundColor Yellow
        Write-Host "  Existing: $ExistingHash"
        Write-Host "  Expected: $ExpectedHash"
        Write-Host "  The file will be downloaded again."
    }

    $TemporaryPath = "$OutputPath.download"
    Remove-Item -LiteralPath $TemporaryPath -Force -ErrorAction SilentlyContinue

    Write-Host "GET    $($Source.File)"
    Write-Host "       $($Source.Url)"

    Invoke-WebRequest `
        -Uri $Source.Url `
        -OutFile $TemporaryPath `
        -UseBasicParsing

    $ActualHash = (Get-FileHash -LiteralPath $TemporaryPath -Algorithm SHA256).Hash.ToLowerInvariant()

    if ($ActualHash -ne $ExpectedHash) {
        Remove-Item -LiteralPath $TemporaryPath -Force -ErrorAction SilentlyContinue
        throw @"
Downloaded file hash does not match the pinned source manifest.

File:     $($Source.File)
URL:      $($Source.Url)
Expected: $ExpectedHash
Actual:   $ActualHash

NIST may have replaced or revised the publication. Review the official publication,
update source_manifest.csv intentionally, and then rerun the download.
"@
    }

    Move-Item -LiteralPath $TemporaryPath -Destination $OutputPath -Force
    $Downloaded++
}

Write-Host ""
Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "Destination: $Destination"
Write-Host "Downloaded : $Downloaded"
Write-Host "Reused     : $Reused"
Write-Host "Total      : $($Sources.Count)"
