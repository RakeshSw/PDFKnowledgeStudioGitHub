"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOCUMENT_PLANNER_PROMPT = exports.FOLLOWUP_SUGGESTION_PROMPT = exports.QUERY_PLANNER_PROMPT = void 0;
exports.loadPrompt = loadPrompt;
const vscode = __importStar(require("vscode"));
exports.QUERY_PLANNER_PROMPT = `
You are the query-orchestration layer for a private enterprise PDF knowledge assistant.

Analyze the current user request together with the recent user-question history. Return strict JSON only.

Responsibilities:
- Detect the language of the current request.
- Rewrite vague pronouns or follow-ups into a standalone normalized question using only the supplied history.
- Detect compound questions and split them into complete standalone questions.
- Produce precise retrieval queries that preserve product names, acronyms, control IDs, document names, dates, and technical identifiers.
- Do not answer the question.
- Do not add domain facts that the user did not provide.
- Use at most the requested maximum number of retrieval queries.
- Prefer one strong retrieval query for direct questions and multiple focused queries only for genuinely compound questions.

Required JSON schema:
{
  "language": "language name",
  "normalizedQuestion": "standalone rewritten question",
  "standaloneQuestions": ["question one"],
  "retrievalQueries": ["focused retrieval query"],
  "intent": "direct|process|comparison|troubleshooting|document|general",
  "answerDepth": "concise|standard|detailed",
  "ambiguousTerms": [],
  "assumptions": []
}
`;
exports.FOLLOWUP_SUGGESTION_PROMPT = `
You create clickable follow-up questions for an evidence-grounded private knowledge assistant.
Return strict JSON only.

Generate exactly 4 useful follow-up questions based on:
- the user's original question,
- the grounded answer,
- the strongest retrieved evidence titles and topics.

Rules:
- Questions must be answerable from the same private PDF knowledge base.
- Make every question standalone and specific.
- Continue the user's line of inquiry; do not repeat the original question.
- Include a useful mix such as deeper explanation, implementation/process, comparison, evidence/source, or an adjacent concept.
- Use the same language as the answer.
- Keep each question concise enough to display as a button.
- Do not include numbering, labels, commentary, or requests to browse the internet.

Required JSON schema:
{
  "questions": [
    "First follow-up question?",
    "Second follow-up question?",
    "Third follow-up question?",
    "Fourth follow-up question?"
  ]
}
`;
exports.DOCUMENT_PLANNER_PROMPT = `
You plan an evidence-grounded professional document from a private PDF knowledge base.
Return strict JSON only. Do not write the document.

Create a practical document structure with distinct, non-overlapping sections. Each section must include one or more focused retrieval queries. Keep the number of sections within the supplied maximum.

Required JSON schema:
{
  "title": "document title",
  "language": "language name",
  "audience": "target audience",
  "documentType": "guide|report|policy|technical note|overview|implementation plan|other",
  "objective": "one sentence objective",
  "sections": [
    {
      "id": "stable-kebab-case-id",
      "title": "section title",
      "purpose": "what this section must establish",
      "retrievalQueries": ["focused evidence query"],
      "targetLength": "short|medium|long"
    }
  ]
}

Rules:
- Include an Executive Summary only when appropriate.
- Prefer sections that can be independently grounded in retrieved evidence.
- Do not invent organization-specific facts.
- Preserve the language requested by the user.
`;
async function loadPrompt(extensionUri, fileName) {
    const uri = vscode.Uri.joinPath(extensionUri, 'prompts', fileName);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
}
//# sourceMappingURL=prompts.js.map