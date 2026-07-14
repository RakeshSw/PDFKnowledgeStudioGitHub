# Architecture

PDF Knowledge Studio is a desktop VS Code extension with local retrieval and a bundled knowledge pack.

```mermaid
sequenceDiagram
    participant U as User
    participant E as Extension
    participant A as Azure OpenAI
    participant R as Local Retrieval
    participant K as Knowledge Pack

    U->>E: Ask a question
    E->>A: Plan intent and focused queries
    A-->>E: Query plan
    E->>R: Retrieve evidence
    R->>K: Search locally
    K-->>R: Candidate records
    R-->>E: Ranked context pack
    E->>A: Generate grounded response
    A-->>E: Answer, document, or lesson
    E-->>U: Render result and citations
```

## Components

- VS Code chat participant and commands
- Document Builder webview
- Knowledge Explorer webview
- Azure OpenAI client
- Local TypeScript retrieval
- Bundled NIST knowledge
- Markdown and Mermaid renderers

## Data boundary

The full knowledge pack, scores, and ranking decisions remain local. The question, selected evidence excerpts, and generation instructions are sent to Azure OpenAI.
