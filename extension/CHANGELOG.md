# Change Log

## 0.4.1

- Added automatic Azure OpenAI 429 retry/backoff with support for rate-limit reset headers.
- Reduced oversized planning, answer, document and Explorer token reservations.
- Reduced the combined evidence prompt budget for reliable low-quota POC usage.
- Generated chat follow-up suggestions locally to remove one Azure call per question.

# Changelog

## 0.4.0

- Removed the runtime Python/FastAPI retrieval dependency.
- Added local TypeScript Retrieval v4.4 with BM25, intent boosts, mismatch penalties, MMR, and balanced context packing.
- Bundled the NIST CSF 2.0 knowledge base inside the VSIX.
- Removed retrieval URL and bearer-token configuration.
- Added one-step Azure OpenAI API-key setup.
- Preserved the Assistant, Document Builder, Mermaid visuals, and Knowledge Explorer.

## 0.3.0

- Added Knowledge Explorer and guided learning.
