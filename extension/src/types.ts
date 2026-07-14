export type RetrievalMode = 'fast' | 'deep';

export interface QueryPlan {
    language: string;
    normalizedQuestion: string;
    standaloneQuestions: string[];
    retrievalQueries: string[];
    intent: 'direct' | 'process' | 'comparison' | 'troubleshooting' | 'document' | 'general';
    answerDepth: 'concise' | 'standard' | 'detailed';
    ambiguousTerms: string[];
    assumptions: string[];
}

export interface RetrievalSource {
    document_id: string;
    file_name: string;
    relative_path: string;
    page_start: number;
    page_end: number;
    chunk_index: number;
}

export interface RetrievalRecord {
    rank: number;
    score: number;
    id: string;
    title: string;
    topic: string;
    subtopics: string[];
    summary: string;
    content: string | null;
    keywords: string[];
    source: RetrievalSource;
    score_breakdown?: Record<string, number> | null;
}

export interface RetrievalResponse {
    request_id: string;
    query: string;
    mode: RetrievalMode;
    knowledge_file: string;
    knowledge_version: string;
    total_records: number;
    matched_records: number;
    parameters: {
        candidate_top_k: number;
        shortlist_k: number;
        final_k: number;
        max_context_chars: number;
    };
    timings: {
        load_ms: number;
        candidate_ms: number;
        rerank_ms: number;
        pack_ms: number;
        total_ms: number;
    };
    records: RetrievalRecord[];
    context_pack: string;
    warnings: string[];
    debug?: Record<string, unknown> | null;
}

export interface EvidenceItem extends RetrievalRecord {
    retrievalQuery: string;
    evidenceNumber: number;
}

export interface CombinedEvidence {
    records: EvidenceItem[];
    contextPack: string;
    requestIds: string[];
    warnings: string[];
    knowledgeVersion: string;
    totalRetrievalMs: number;
}

export interface GroundedAnswerResult {
    answer: string;
    plan: QueryPlan;
    evidence: CombinedEvidence;
    suggestedQuestions: string[];
}

export interface FollowupSuggestionResponse {
    questions: string[];
}

export interface DocumentSectionPlan {
    id: string;
    title: string;
    purpose: string;
    retrievalQueries: string[];
    targetLength: 'short' | 'medium' | 'long';
}

export interface DocumentPlan {
    title: string;
    language: string;
    audience: string;
    documentType: string;
    objective: string;
    sections: DocumentSectionPlan[];
}

export interface MermaidDiagramResult {
    title: string;
    diagramType: string;
    mermaid: string;
    explanation: string;
}

export interface BuiltSection {
    id: string;
    title: string;
    markdown: string;
    sources: RetrievalSource[];
    kind?: 'content' | 'diagram';
}

export interface DocumentState {
    title: string;
    language: string;
    audience: string;
    documentType: string;
    objective: string;
    originalPrompt: string;
    sections: BuiltSection[];
    markdown: string;
    updatedAt: string;
}


export interface KnowledgeMapNode {
    id: string;
    label: string;
    category: string;
    summary: string;
    explorationQuery: string;
    evidenceNumbers: number[];
    sources: RetrievalSource[];
}

export interface KnowledgeMapEdge {
    from: string;
    to: string;
    label: string;
}

export interface KnowledgeMap {
    title: string;
    overview: string;
    topic: string;
    language: string;
    learningLevel: string;
    rootNodeId: string;
    nodes: KnowledgeMapNode[];
    edges: KnowledgeMapEdge[];
    guidedOrder: string[];
    mermaid: string;
    sources: RetrievalSource[];
    knowledgeVersion: string;
    generatedAt: string;
}

export interface KnowledgeRelatedConcept {
    label: string;
    query: string;
    relationship: string;
}

export interface KnowledgeCheck {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
}

export interface KnowledgeNodeDetail {
    nodeId: string;
    title: string;
    category: string;
    overview: string;
    whyItMatters: string;
    keyIdeas: string[];
    steps: string[];
    commonMisunderstandings: string[];
    relatedConcepts: KnowledgeRelatedConcept[];
    suggestedQuestions: string[];
    visualTitle: string;
    visualMermaid: string;
    knowledgeCheck?: KnowledgeCheck;
    sources: RetrievalSource[];
    generatedAt: string;
}

export interface KnowledgeExplorerState {
    map?: KnowledgeMap;
    selectedNodeId?: string;
    detail?: KnowledgeNodeDetail;
    learningLevel: string;
    retrievalMode: RetrievalMode;
    updatedAt: string;
}

export interface ChatMetadata {
    originalPrompt: string;
    command: string;
    sources: RetrievalSource[];
    language: string;
    suggestedQuestions: string[];
}
