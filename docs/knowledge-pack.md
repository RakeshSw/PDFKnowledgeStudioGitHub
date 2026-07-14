# Knowledge Pack

The checked-in extension contains 9 validated JSONL records.

```text
extension/media/knowledge/knowledge.jsonl
extension/media/knowledge/manifest.json
```

Replace it with a larger generated pack using:

```powershell
.\scripts\replace-knowledge-pack.ps1 `
  -KnowledgeFile "C:\path\to\knowledge.jsonl"
```

The utility validates every non-empty line, copies the file, and updates the record count and SHA256.
