# PDF Knowledge Assistant

A self-contained VS Code AI knowledge product built from public NIST CSF 2.0 documents.

## Runtime requirements

- VS Code 1.99 or later
- Your Azure OpenAI endpoint, deployment name, API version, and API key

Python, Node.js, npm, FastAPI, Docker, and a retrieval service are **not required** for users of the installed VSIX.

## Quick start

1. Install the VSIX.
2. Reload VS Code.
3. Run **PDF Knowledge: Configure Azure OpenAI**.
4. Enter your Azure OpenAI endpoint, deployment name, API version, and API key.
5. Run **PDF Knowledge: Test Local Knowledge and Azure OpenAI**.
6. Ask `@pdf-knowledge What are the six NIST CSF functions?`

## Included products

- Grounded PDF Knowledge Assistant
- Evidence-grounded Document Builder
- Interactive Knowledge Explorer with visual learning paths

## Architecture

The VSIX includes a local TypeScript retrieval engine and a bundled NIST CSF knowledge pack. Azure OpenAI is used for query planning and grounded generation only.

The API key is stored in VS Code SecretStorage and is not included in the extension source or knowledge pack.

<!-- creator-and-publisher:start -->
## Creator and publisher

PDF Knowledge Studio is designed and maintained by **[Rakesh Swain](https://github.com/RakeshSw)**.

- [GitHub profile](https://github.com/RakeshSw)
- [Project repository](https://github.com/RakeshSw/PDFKnowledgeStudioGitHub)
- [Report an issue](https://github.com/RakeshSw/PDFKnowledgeStudioGitHub/issues)

This extension demonstrates a self-contained Visual Studio Code knowledge platform with local evidence retrieval and Azure OpenAI grounded generation.
<!-- creator-and-publisher:end -->
