# Official Source Documents

The demonstration knowledge base is built from the following official National Institute of Standards and Technology publications.

The repository does not need to commit the PDF binaries. Run:

```powershell
.\knowledge-pipeline\download_source_pdfs.ps1
```

The script downloads each publication from its official NIST URL and verifies its pinned SHA256.

| # | Local filename | Publication | Status in source pack | Pages | Official source |
|---:|---|---|---|---:|---|
| 01 | `01_NIST_CSF_2.0_Core_Framework.pdf` | The NIST Cybersecurity Framework (CSF) 2.0 | Final | 32 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf) |
| 02 | `02_CSF_2.0_Resource_and_Overview_Guide.pdf` | NIST Cybersecurity Framework 2.0: Resource & Overview Guide | Final | 8 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1299.pdf) |
| 03 | `03_Creating_and_Using_Organizational_Profiles.pdf` | Quick-Start Guide for Creating and Using Organizational Profiles | Final | 10 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1301.pdf) |
| 04 | `04_Creating_Community_Profiles.pdf` | NIST CSF 2.0: A Guide to Creating Community Profiles | Initial Public Draft | 17 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.32.ipd.pdf) |
| 05 | `05_Small_Business_Quick_Start_Guide.pdf` | NIST Cybersecurity Framework 2.0: Small Business Quick-Start Guide | Final | 9 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1300.pdf) |
| 06 | `06_Cybersecurity_Supply_Chain_Risk_Management.pdf` | Quick-Start Guide for Cybersecurity Supply Chain Risk Management | Final | 7 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1305.pdf) |
| 07 | `07_Using_the_CSF_Tiers.pdf` | Quick-Start Guide for Using the CSF Tiers | Final | 3 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1302.pdf) |
| 08 | `08_Enterprise_Risk_Management_Quick_Start_Guide.pdf` | NIST Cybersecurity Framework 2.0: Enterprise Risk Management Quick-Start Guide | Final | 8 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1303.pdf) |
| 09 | `09_Cybersecurity_ERM_and_Workforce_Management.pdf` | Cybersecurity, Enterprise Risk Management, and Workforce Management | Final | 11 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1308.pdf) |
| 10 | `10_Informative_References_Quick_Start_Guide.pdf` | NIST Cybersecurity Framework 2.0: Informative References Quick-Start Guide | Initial Public Draft | 10 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1347.ipd.pdf) |
| 11 | `11_Incident_Response_CSF_2.0_Community_Profile.pdf` | Incident Response Recommendations and Considerations for Cybersecurity Risk Management | Final | 48 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r3.pdf) |
| 12 | `12_Ransomware_Risk_Management_CSF_2.0_Profile.pdf` | Ransomware Risk Management: A CSF 2.0 Community Profile | Final | 23 | [Official PDF](https://nvlpubs.nist.gov/nistpubs/ir/2026/NIST.IR.8374r1.pdf) |

## Publication status

Two source documents in the pinned source pack are Initial Public Drafts:

- Community Profiles
- Informative References Quick-Start Guide

All other entries are marked final in the source manifest used to assemble the demonstration pack.

Before using the material for policy or production decisions, verify the current publication status on NIST's CSF resource center. A deliberate source update should include:

1. Updating the URL or publication status when necessary.
2. Downloading the revised file.
3. Updating the SHA256 in `knowledge-pipeline/source_manifest.csv`.
4. Rebuilding the knowledge pack.
5. Rerunning retrieval benchmarks.
