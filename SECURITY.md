# Security Policy

## Secrets

- Never commit Azure OpenAI API keys.
- Never paste keys into public issues.
- The extension stores the API key through VS Code SecretStorage.
- Review logs and screenshots before publication.

## Data flow

Remains local:

- bundled knowledge
- retrieval computation
- ranking scores
- context selection

Sent to Azure OpenAI:

- user question
- selected evidence excerpts
- planning and generation instructions

## Reporting

Use GitHub private vulnerability reporting when enabled, or contact the repository owner privately.

## Production notice

This repository is a proof of concept. Production use requires organization-specific identity, governance, retention, logging, threat-model, and cost reviews.
