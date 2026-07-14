# Installation

1. Download the VSIX from GitHub Releases.
2. Run `Extensions: Install from VSIX`.
3. Reload VS Code.
4. Run `PDF Knowledge: Configure Azure OpenAI`.
5. Enter the API key supplied separately.
6. Run `PDF Knowledge: Test Local Knowledge and Azure OpenAI`.

This repository snapshot includes 9 local knowledge records.

No Python service, Docker container, vector database, or retrieval URL is required.

## Common errors

### 401

The key does not match the configured Azure OpenAI resource.

### 429

The deployment reached a temporary request or token limit. v0.4.1 includes bounded retry and reduced token reservations.

### Local knowledge failure

Confirm the VSIX contains:

```text
extension/media/knowledge/manifest.json
extension/media/knowledge/knowledge.jsonl
```
