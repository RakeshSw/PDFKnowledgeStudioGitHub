import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { RetrievalMode, RetrievalRecord, RetrievalResponse, RetrievalSource } from './types';

interface HealthResponse {
    status: string;
    version: string;
    records_loaded: number;
    knowledge_version: string;
}

interface RawRecord {
    [key: string]: unknown;
}

interface IndexedRecord {
    raw: RawRecord;
    id: string;
    title: string;
    topic: string;
    subtopics: string[];
    summary: string;
    content: string;
    keywords: string[];
    domain: string;
    subdomain: string;
    source: RetrievalSource;
    evidenceCoverage: string;
    allText: string;
    allTokens: string[];
    tokenCounts: Map<string, number>;
    titleTokens: Set<string>;
    topicTokens: Set<string>;
    keywordTokens: Set<string>;
    questionTokens: Set<string>;
    componentTokens: Set<string>;
    uniqueTokens: Set<string>;
}

interface ScoredRecord {
    record: IndexedRecord;
    bm25: number;
    field: number;
    phrase: number;
    intent: number;
    mismatch: number;
    coverage: number;
    coverageRatio: number;
    rawScore: number;
    normalizedScore: number;
    finalScore: number;
    breakdown: Record<string, number>;
}

const SERVICE_VERSION = '4.4.0-local';
const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9_.:/-]*/g;

const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by',
    'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has',
    'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'may',
    'might', 'of', 'on', 'or', 'our', 'should', 'that', 'the', 'their',
    'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to',
    'use', 'used', 'using', 'was', 'we', 'were', 'what', 'when',
    'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you',
    'your', 'define', 'list', 'name', 'explain', 'please', 'tell'
]);

const DOCUMENT_TASK_WORDS = new Set([
    'generate', 'draft', 'write', 'comprehensive', 'report', 'document',
    'full', 'detailed', 'analysis'
]);

const QUERY_EXPANSIONS: Array<[string[], string[]]> = [
    [['six functions', 'csf functions', 'framework functions'], ['csf', 'govern', 'identify', 'protect', 'detect', 'respond', 'recover']],
    [['organizational profile', 'current profile', 'target profile'], ['profile', 'current', 'target', 'scope', 'gap', 'action', 'plan']],
    [['community profile'], ['community', 'profile', 'shared', 'sector']],
    [['csf tiers', 'framework tiers', 'cybersecurity tiers'], ['tier', 'partial', 'risk-informed', 'repeatable', 'adaptive']],
    [['informative reference', 'informative references'], ['mapping', 'standard', 'control', 'crosswalk', 'reference']],
    [['incident response', 'cyber incident'], ['incident', 'response', 'detect', 'respond', 'recover', 'preparation']],
    [['supply chain', 'c-scrm', 'supplier'], ['supplier', 'supply', 'chain', 'c-scrm', 'gv.sc']],
    [['ransomware'], ['ransomware', 'incident', 'recover', 'response']],
    [['enterprise risk management', 'erm'], ['enterprise', 'risk', 'management', 'erm']],
    [['workforce'], ['workforce', 'roles', 'skills', 'nice']]
];

const DIRECT_QUERY_MARKERS = ['what is', 'what are', 'define ', 'list ', 'name ', 'which ', 'who is'];
const PROCESS_QUERY_MARKERS = [
    'how should', 'how do', 'how can', 'steps', 'process', 'workflow',
    'lifecycle', 'life cycle', 'create and use', 'implement', 'apply ', 'analyze gaps'
];
const DOCUMENT_QUERY_MARKERS = [
    'generate a document', 'create a document', 'draft a document',
    'generate a report', 'create a report', 'write a report',
    'comprehensive report', 'technical document', 'policy document',
    'implementation plan', 'full analysis', 'detailed analysis'
];

type QueryKind = 'direct' | 'process' | 'document' | 'general';
type QuerySubject =
    | 'functions'
    | 'organizational_profile'
    | 'community_profile'
    | 'tiers'
    | 'informative_references'
    | 'incident_response'
    | 'supply_chain'
    | 'ransomware'
    | 'erm'
    | 'workforce'
    | 'small_business';

function nowMs(): number {
    return Number(process.hrtime.bigint()) / 1_000_000;
}

function cleanText(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    let text = typeof value === 'string' ? value : String(value);
    const replacements: Array<[string, string]> = [
        ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€', '”'],
        ['â€“', '–'], ['â€”', '—'], ['â€¦', '…'], ['â€¢', '•'],
        ['Ã¢Â¦', '…'], ['Ã¢Â¢', '•'], ['â¦', '…'], ['â¢', '•'],
        ['ï¼', '• '], ['Â ', ' '], ['Â', '']
    ];

    for (let pass = 0; pass < 3; pass += 1) {
        const previous = text;
        for (const [broken, repaired] of replacements) {
            text = text.split(broken).join(repaired);
        }
        text = text
            .replace(/([A-Za-z])Ã¢s\b/g, '$1’s')
            .replace(/([A-Za-z])âs\b/g, '$1’s')
            .replace(/([A-Za-z0-9)])Ã¢(?=\s+[A-Za-z0-9(])/g, '$1 —')
            .replace(/([A-Za-z0-9)])â(?=\s+[A-Za-z0-9(])/g, '$1 —')
            .replace(/\s+Ã¢\s+/g, ' — ')
            .replace(/\s+â\s+/g, ' — ')
            .replace(/([A-Za-z0-9])Ã¢(?=[,.;:!?\s])/g, '$1’')
            .replace(/([A-Za-z0-9])â(?=[,.;:!?\s])/g, '$1’')
            .replace(/Ã¢/g, '')
            .replace(/â/g, '');
        if (text === previous) {
            break;
        }
    }

    return text
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/•\s*/g, '• ')
        .replace(/\s+—\s+/g, ' — ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function stringList(value: unknown): string[] {
    if (value === null || value === undefined) {
        return [];
    }
    const values = Array.isArray(value) ? value : [value];
    const output: string[] = [];
    const seen = new Set<string>();
    for (const item of values) {
        const cleaned = cleanText(item);
        const key = cleaned.toLowerCase();
        if (cleaned && !seen.has(key)) {
            seen.add(key);
            output.push(cleaned);
        }
    }
    return output;
}

function flattenStructured(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap(flattenStructured);
    }
    if (value && typeof value === 'object') {
        const output: string[] = [];
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            output.push(cleanText(key));
            output.push(...flattenStructured(item));
        }
        return output.filter(Boolean);
    }
    const cleaned = cleanText(value);
    return cleaned ? [cleaned] : [];
}

function tokenize(text: string): string[] {
    return [...text.matchAll(TOKEN_RE)].map(match => match[0].toLowerCase());
}

function tokenSet(text: string): Set<string> {
    return new Set(tokenize(text));
}

function countTokens(tokens: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const token of tokens) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return counts;
}

function queryKind(query: string): QueryKind {
    const folded = query.toLowerCase();
    if (DOCUMENT_QUERY_MARKERS.some(marker => folded.includes(marker))) {
        return 'document';
    }
    if (PROCESS_QUERY_MARKERS.some(marker => folded.includes(marker))) {
        return 'process';
    }
    if (DIRECT_QUERY_MARKERS.some(marker => folded.includes(marker))) {
        return 'direct';
    }
    return 'general';
}

function meaningfulQueryTokens(query: string): string[] {
    const folded = query.toLowerCase();
    const seen = new Set<string>();
    const output: string[] = [];
    const kind = queryKind(query);

    const add = (value: string): void => {
        const token = value.toLowerCase().trim().replace(/^[._:/-]+|[._:/-]+$/g, '');
        if (!token || seen.has(token) || STOPWORDS.has(token)) {
            return;
        }
        if (kind === 'document' && DOCUMENT_TASK_WORDS.has(token)) {
            return;
        }
        if (token.length === 1 && !/^\d$/.test(token)) {
            return;
        }
        seen.add(token);
        output.push(token);
    };

    tokenize(query).forEach(add);
    for (const [markers, expansions] of QUERY_EXPANSIONS) {
        if (markers.some(marker => folded.includes(marker))) {
            expansions.forEach(add);
        }
    }
    return output;
}

function querySubjects(query: string): Set<QuerySubject> {
    const folded = query.toLowerCase();
    const checks: Array<[QuerySubject, string[]]> = [
        ['functions', ['six functions', 'csf functions', 'framework functions', 'govern identify protect']],
        ['organizational_profile', ['organizational profile', 'current profile', 'target profile']],
        ['community_profile', ['community profile']],
        ['tiers', ['csf tiers', 'framework tiers', ' tier', 'tiers']],
        ['informative_references', ['informative reference', 'crosswalk', 'mapping']],
        ['incident_response', ['incident response', 'cyber incident']],
        ['supply_chain', ['supply chain', 'c-scrm', 'supplier']],
        ['ransomware', ['ransomware']],
        ['erm', ['enterprise risk management', ' erm']],
        ['workforce', ['workforce']],
        ['small_business', ['small business', 'smb']]
    ];
    return new Set(checks.filter(([, markers]) => markers.some(marker => folded.includes(marker))).map(([subject]) => subject));
}

function coverageScore(value: string): number {
    return ({ high: 1, medium: 0.65, low: 0.25 } as Record<string, number>)[value.toLowerCase()] ?? 0.4;
}

function sourceKey(record: IndexedRecord): string {
    return [record.source.file_name, record.title, record.topic, ...record.subtopics]
        .join(' ')
        .toLowerCase();
}

function subjectIntentScore(
    record: IndexedRecord,
    kind: QueryKind,
    subjects: Set<QuerySubject>
): { intent: number; mismatch: number } {
    const key = sourceKey(record);
    const text = record.allText.toLowerCase();
    const titleTopic = `${record.title} ${record.topic}`.toLowerCase();
    let intent = 0;
    let mismatch = 0;

    if (subjects.has('functions')) {
        const present = ['govern', 'identify', 'protect', 'detect', 'respond', 'recover']
            .filter(value => text.includes(value)).length;
        intent += 0.65 * present;
        if (present === 6) intent += 2.2;
        if (key.includes('resource_and_overview')) intent += 2;
        if (key.includes('core_framework')) intent += 1.8;
        if (titleTopic.includes('functions')) intent += 1.2;
        if (titleTopic.includes('glossary')) intent += 0.6;
    }

    if (subjects.has('organizational_profile')) {
        if (key.includes('creating_and_using_organizational_profiles')) intent += 5;
        if (titleTopic.includes('organizational profile')) intent += 2.2;
        if (key.includes('core_framework')) intent += 1.4;
        if (key.includes('cybersecurity_erm_and_workforce')) intent += 0.8;
        if (key.includes('informative_references')) intent += 0.6;
        if (titleTopic.includes('community profile')) mismatch += 2.5;
        if (key.includes('incident_response')) mismatch += 1.8;
        if (key.includes('ransomware')) mismatch += 2;
        if (key.includes('supply_chain')) mismatch += 1.5;
    }

    if (subjects.has('community_profile')) {
        if (key.includes('creating_community_profiles')) intent += 5;
        if (titleTopic.includes('community profile')) intent += 2.2;
        if (titleTopic.includes('organizational profile')) mismatch += 0.8;
    }

    if (subjects.has('tiers')) {
        if (key.includes('using_the_csf_tiers')) intent += 5;
        if (titleTopic.includes('tiers')) intent += 2;
        if (key.includes('core_framework')) intent += 1.2;
    }

    if (subjects.has('informative_references')) {
        if (key.includes('informative_references')) intent += 5;
        if (titleTopic.includes('informative reference')) intent += 2;
        if (key.includes('core_framework') || key.includes('resource_and_overview')) intent += 1;
    }

    if (subjects.has('incident_response')) {
        if (key.includes('incident_response')) intent += 5;
        if (titleTopic.includes('incident response')) intent += 2;
        if (key.includes('core_framework')) intent += 0.8;
    }

    if (subjects.has('supply_chain')) {
        if (key.includes('supply_chain_risk_management')) intent += 5;
        if (titleTopic.includes('supply chain') || titleTopic.includes('c-scrm')) intent += 2;
        if (key.includes('core_framework')) intent += 0.8;
    }

    if (subjects.has('ransomware')) {
        if (key.includes('ransomware_risk_management')) intent += 5;
        if (titleTopic.includes('ransomware')) intent += 2;
        if (key.includes('incident_response')) intent += 0.8;
    }

    if (subjects.has('erm')) {
        if (key.includes('enterprise_risk_management')) intent += 5;
        if (titleTopic.includes('enterprise risk management')) intent += 2;
        if (key.includes('cybersecurity_erm_and_workforce')) intent += 1.5;
    }

    if (subjects.has('workforce')) {
        if (key.includes('cybersecurity_erm_and_workforce')) intent += 5;
        if (titleTopic.includes('workforce')) intent += 2;
    }

    if (subjects.has('small_business')) {
        if (key.includes('small_business')) intent += 5;
        if (titleTopic.includes('small business')) intent += 2;
    }

    if (kind === 'document' && subjects.size === 0) {
        if (key.includes('core_framework')) intent += 3.5;
        if (key.includes('resource_and_overview')) intent += 3;
        if (key.includes('creating_and_using_organizational_profiles')) intent += 2.4;
        if (key.includes('informative_references')) intent += 2.1;
        if (key.includes('enterprise_risk_management')) intent += 1.8;
        if (key.includes('cybersecurity_erm_and_workforce')) intent += 1.5;
        if (key.includes('using_the_csf_tiers')) intent += 1;
    }

    const scale = kind === 'document' ? 0.55 : 1;
    if (key.includes('small_business') && !subjects.has('small_business')) mismatch += 1.3 * scale;
    if (key.includes('incident_response') && !subjects.has('incident_response')) mismatch += 1.4 * scale;
    if (key.includes('ransomware') && !subjects.has('ransomware')) mismatch += 1.8 * scale;
    if (key.includes('supply_chain') && !subjects.has('supply_chain')) mismatch += 1.1 * scale;
    if (key.includes('creating_community_profiles') && !subjects.has('community_profile')) mismatch += 1.2 * scale;

    return { intent, mismatch };
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
    let size = 0;
    for (const value of left) {
        if (right.has(value)) size += 1;
    }
    return size;
}

function similarity(left: IndexedRecord, right: IndexedRecord): number {
    const intersection = intersectionSize(left.uniqueTokens, right.uniqueTokens);
    const unionSize = left.uniqueTokens.size + right.uniqueTokens.size - intersection;
    const tokenSimilarity = unionSize ? intersection / unionSize : 0;
    const sameDocument = Boolean(left.source.document_id)
        && left.source.document_id === right.source.document_id;
    const pageOverlap = sameDocument
        && Math.max(left.source.page_start, right.source.page_start)
            <= Math.min(left.source.page_end, right.source.page_end);
    return Math.min(1, tokenSimilarity + (pageOverlap ? 0.22 : sameDocument ? 0.08 : 0));
}

function relevancePolicy(kind: QueryKind): { floor: number; minimumKeep: number; perDocumentLimit: number } {
    if (kind === 'direct') return { floor: 0.5, minimumKeep: 4, perDocumentLimit: 3 };
    if (kind === 'process') return { floor: 0.38, minimumKeep: 6, perDocumentLimit: 4 };
    if (kind === 'document') return { floor: 0.2, minimumKeep: 12, perDocumentLimit: 5 };
    return { floor: 0.32, minimumKeep: 6, perDocumentLimit: 4 };
}

function adaptiveFinalK(mode: RetrievalMode, kind: QueryKind): number {
    if (mode === 'fast') {
        return ({ direct: 6, process: 10, general: 8, document: 14 } as Record<QueryKind, number>)[kind];
    }
    return ({ direct: 8, process: 12, general: 10, document: 22 } as Record<QueryKind, number>)[kind];
}

function modeParameters(mode: RetrievalMode, kind: QueryKind, overrideFinalK?: number): {
    candidate_top_k: number;
    shortlist_k: number;
    final_k: number;
    max_context_chars: number;
} {
    const base = mode === 'fast'
        ? { candidate_top_k: 60, shortlist_k: 30, max_context_chars: 50000 }
        : { candidate_top_k: 150, shortlist_k: 60, max_context_chars: 90000 };
    return {
        ...base,
        final_k: Math.max(1, Math.min(overrideFinalK ?? adaptiveFinalK(mode, kind), 30))
    };
}

function normalizeSource(value: unknown): RetrievalSource {
    const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const pageStart = Number(source.page_start ?? 0) || 0;
    return {
        document_id: cleanText(source.document_id),
        file_name: cleanText(source.file_name),
        relative_path: cleanText(source.relative_path),
        page_start: pageStart,
        page_end: Number(source.page_end ?? pageStart) || pageStart,
        chunk_index: Number(source.chunk_index ?? 0) || 0
    };
}

function indexRecord(raw: RawRecord): IndexedRecord {
    const retrieval = raw.retrieval && typeof raw.retrieval === 'object'
        ? raw.retrieval as Record<string, unknown>
        : {};
    const title = cleanText(raw.title);
    const topic = cleanText(raw.topic);
    const subtopics = stringList(raw.subtopics);
    const summary = cleanText(raw.summary);
    const content = cleanText(raw.content);
    const keywords = stringList(raw.keywords);
    const questions = flattenStructured(raw.questions_answered ?? []);
    const components = flattenStructured(raw.systems_components ?? []);
    const searchText = cleanText(retrieval.search_text);
    const allText = searchText || [
        title,
        topic,
        subtopics.join('\n'),
        summary,
        keywords.join('\n'),
        questions.join('\n'),
        components.join('\n'),
        flattenStructured(raw.facts ?? []).join('\n'),
        flattenStructured(raw.processes ?? []).join('\n'),
        flattenStructured(raw.requirements ?? []).join('\n'),
        flattenStructured(raw.controls ?? []).join('\n'),
        flattenStructured(raw.roles ?? []).join('\n'),
        flattenStructured(raw.glossary ?? []).join('\n'),
        flattenStructured(raw.standards_references ?? []).join('\n'),
        content
    ].filter(Boolean).join('\n');
    const allTokens = tokenize(allText);

    return {
        raw,
        id: cleanText(raw.id ?? raw.chunk_id),
        title,
        topic,
        subtopics,
        summary,
        content,
        keywords,
        domain: cleanText(raw.domain),
        subdomain: cleanText(raw.subdomain),
        source: normalizeSource(raw.source),
        evidenceCoverage: cleanText(retrieval.evidence_coverage),
        allText,
        allTokens,
        tokenCounts: countTokens(allTokens),
        titleTokens: tokenSet(title),
        topicTokens: tokenSet(`${topic} ${subtopics.join(' ')}`),
        keywordTokens: tokenSet(keywords.join(' ')),
        questionTokens: tokenSet(questions.join(' ')),
        componentTokens: tokenSet(components.join(' ')),
        uniqueTokens: new Set(allTokens)
    };
}

function buildContextPack(query: string, selected: ScoredRecord[], maxChars: number): string {
    const header = [
        '# RETRIEVAL CONTEXT PACK',
        `Question: ${query}`,
        'Instruction: Answer only from the evidence below. Cite source filename and page range. Clearly label unsupported information as Missing.',
        ''
    ].join('\n');
    if (!selected.length) return header.trim();

    const sections: string[] = [];
    let remainingBudget = Math.max(maxChars - header.length - 1, 1000);
    let remainingRecords = selected.length;

    selected.forEach((item, index) => {
        if (remainingBudget < 250) return;
        const source = item.record.source;
        const pages = source.page_start === source.page_end
            ? `page ${source.page_start}`
            : `pages ${source.page_start}-${source.page_end}`;
        const metadata = [
            `## Evidence ${index + 1}`,
            `Source: ${source.file_name || 'Unknown source'}, ${pages}`,
            `Record: ${item.record.id}`,
            `Relevance: ${(item.finalScore * 100).toFixed(2)}`,
            `Title: ${item.record.title}`,
            `Topic: ${item.record.topic}`,
            `Summary: ${item.record.summary}`,
            'Content:'
        ].join('\n');
        const fairShare = Math.max(1200, Math.floor(remainingBudget / Math.max(remainingRecords, 1)));
        const contentBudget = Math.max(300, fairShare - metadata.length - 2);
        let content = item.record.content;
        if (content.length > contentBudget) {
            content = `${content.slice(0, contentBudget).trimEnd()}\n[Evidence excerpt truncated for balanced packing]`;
        }
        let section = `${metadata}\n${content}\n`;
        if (section.length > remainingBudget) {
            section = `${section.slice(0, remainingBudget).trimEnd()}\n[Evidence truncated]`;
        }
        if (section.length >= 250) {
            sections.push(section);
            remainingBudget -= section.length + 1;
            remainingRecords -= 1;
        }
    });

    return cleanText(`${header}${sections.join('\n')}`.replace(/\n{3,}/g, '\n\n'));
}

export class RetrievalClient {
    private records?: IndexedRecord[];
    private documentFrequency = new Map<string, number>();
    private averageDocumentLength = 1;
    private knowledgeVersion = '';
    private loading?: Promise<void>;

    public constructor(private readonly extensionUri: vscode.Uri) {}

    private async ensureLoaded(): Promise<void> {
        if (this.records) return;
        if (this.loading) return this.loading;

        this.loading = (async () => {
            const uri = vscode.Uri.joinPath(this.extensionUri, 'media', 'knowledge', 'knowledge.jsonl');
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            const loaded = lines.map((line, index) => {
                try {
                    return indexRecord(JSON.parse(line) as RawRecord);
                } catch (error) {
                    throw new Error(`Invalid bundled knowledge JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
                }
            });
            if (!loaded.length) {
                throw new Error('The bundled knowledge pack contains no records.');
            }

            const df = new Map<string, number>();
            let totalLength = 0;
            for (const record of loaded) {
                totalLength += record.allTokens.length;
                for (const token of record.uniqueTokens) {
                    df.set(token, (df.get(token) ?? 0) + 1);
                }
            }

            const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
            this.records = loaded;
            this.documentFrequency = df;
            this.averageDocumentLength = Math.max(totalLength / loaded.length, 1);
            this.knowledgeVersion = `nist-csf-2.0:${loaded.length}:${hash}`;
        })();

        try {
            await this.loading;
        } finally {
            this.loading = undefined;
        }
    }

    private bm25(record: IndexedRecord, queryTokens: string[]): number {
        const records = this.records ?? [];
        const nDocs = Math.max(records.length, 1);
        const docLength = Math.max(record.allTokens.length, 1);
        const k1 = 1.35;
        const b = 0.72;
        let score = 0;
        for (const token of queryTokens) {
            const frequency = record.tokenCounts.get(token) ?? 0;
            if (!frequency) continue;
            const df = this.documentFrequency.get(token) ?? 0;
            const idf = Math.log(1 + (nDocs - df + 0.5) / (df + 0.5));
            const denominator = frequency + k1 * (1 - b + b * docLength / this.averageDocumentLength);
            score += idf * (frequency * (k1 + 1)) / denominator;
        }
        return score;
    }

    private fieldScore(record: IndexedRecord, querySet: Set<string>): number {
        if (!querySet.size) return 0;
        const overlap = (tokens: Set<string>): number => intersectionSize(querySet, tokens) / querySet.size;
        return 4.4 * overlap(record.titleTokens)
            + 3.6 * overlap(record.topicTokens)
            + 3.2 * overlap(record.keywordTokens)
            + 2.8 * overlap(record.questionTokens)
            + 2 * overlap(record.componentTokens)
            + 0.9 * overlap(record.uniqueTokens);
    }

    private phraseScore(record: IndexedRecord, query: string, queryTokens: string[]): number {
        const text = record.allText.toLowerCase();
        const title = record.title.toLowerCase();
        const topic = record.topic.toLowerCase();
        const folded = query.toLowerCase().trim();
        let score = 0;
        if (folded.length >= 5 && text.includes(folded)) score += 1.4;
        if (folded.length >= 5 && title.includes(folded)) score += 2.2;
        if (folded.length >= 5 && topic.includes(folded)) score += 1.6;
        const meaningful = queryTokens.filter(token => token.length >= 3);
        for (const [size, value] of [[4, 0.8], [3, 0.55], [2, 0.3]] as Array<[number, number]>) {
            if (meaningful.length < size) continue;
            let hits = 0;
            for (let i = 0; i <= meaningful.length - size; i += 1) {
                if (text.includes(meaningful.slice(i, i + size).join(' '))) hits += 1;
            }
            score += Math.min(1.6, hits * value);
        }
        return score;
    }

    private search(query: string, mode: RetrievalMode, overrideFinalK?: number): {
        selected: ScoredRecord[];
        parameters: RetrievalResponse['parameters'];
        timings: { candidate_ms: number; rerank_ms: number };
        debug: Record<string, unknown>;
    } {
        const candidateStarted = nowMs();
        const kind = queryKind(query);
        const subjects = querySubjects(query);
        const queryTokens = meaningfulQueryTokens(query);
        const querySet = new Set(queryTokens);
        const parameters = modeParameters(mode, kind, overrideFinalK);
        const scored: ScoredRecord[] = [];

        for (const record of this.records ?? []) {
            const overlapCount = intersectionSize(querySet, record.uniqueTokens);
            const coverageRatio = querySet.size ? overlapCount / querySet.size : 0;
            const { intent, mismatch } = subjectIntentScore(record, kind, subjects);
            const bm25 = this.bm25(record, queryTokens);
            if (!overlapCount && intent <= 0) continue;
            if (coverageRatio < 0.1 && intent < 1 && bm25 < 0.35) continue;
            const field = this.fieldScore(record, querySet);
            const phrase = this.phraseScore(record, query, queryTokens);
            const coverage = coverageScore(record.evidenceCoverage);
            const rawScore = 0.38 * bm25 + 0.25 * field + 0.1 * phrase + 0.25 * intent + 0.02 * coverage - 0.32 * mismatch;
            if (rawScore <= 0) continue;
            scored.push({
                record,
                bm25,
                field,
                phrase,
                intent,
                mismatch,
                coverage,
                coverageRatio,
                rawScore,
                normalizedScore: 0,
                finalScore: 0,
                breakdown: {}
            });
        }

        scored.sort((a, b) => b.rawScore - a.rawScore);
        const candidates = scored.slice(0, parameters.candidate_top_k);
        const candidateMs = nowMs() - candidateStarted;
        const rerankStarted = nowMs();
        const maxScore = Math.max(...candidates.map(item => item.rawScore), 1);
        candidates.forEach(item => {
            item.normalizedScore = Math.max(0, item.rawScore / maxScore);
            item.breakdown = {
                bm25: item.bm25,
                field: item.field,
                phrase: item.phrase,
                intent: item.intent,
                mismatch: item.mismatch,
                coverage: item.coverage,
                coverage_ratio: item.coverageRatio,
                raw: item.rawScore,
                normalized: item.normalizedScore
            };
        });

        const policy = relevancePolicy(kind);
        const shortlistBase = candidates.slice(0, parameters.shortlist_k);
        const remaining = shortlistBase.filter((item, index) => index < policy.minimumKeep || item.normalizedScore >= policy.floor);
        const selected: ScoredRecord[] = [];
        const documentCounts = new Map<string, number>();
        let relevanceWeight = 0.92;
        let diversityWeight = 0.08;
        if (kind === 'direct') {
            relevanceWeight = 0.96;
            diversityWeight = 0.04;
        } else if (kind === 'process') {
            relevanceWeight = 0.94;
            diversityWeight = 0.06;
        }

        while (remaining.length && selected.length < parameters.final_k) {
            let bestIndex = -1;
            let bestValue = -Infinity;
            for (let i = 0; i < remaining.length; i += 1) {
                const item = remaining[i];
                const documentId = item.record.source.document_id || item.record.source.file_name || item.record.id;
                if ((documentCounts.get(documentId) ?? 0) >= policy.perDocumentLimit) continue;
                const redundancy = Math.max(0, ...selected.map(chosen => similarity(item.record, chosen.record)));
                const value = relevanceWeight * item.normalizedScore - diversityWeight * redundancy;
                if (value > bestValue) {
                    bestValue = value;
                    bestIndex = i;
                }
            }
            if (bestIndex < 0) break;
            const [best] = remaining.splice(bestIndex, 1);
            best.finalScore = Math.max(0, Math.min(1, bestValue));
            best.breakdown.mmr = best.finalScore;
            selected.push(best);
            const documentId = best.record.source.document_id || best.record.source.file_name || best.record.id;
            documentCounts.set(documentId, (documentCounts.get(documentId) ?? 0) + 1);
        }

        return {
            selected,
            parameters,
            timings: { candidate_ms: candidateMs, rerank_ms: nowMs() - rerankStarted },
            debug: {
                query_kind: kind,
                query_subjects: [...subjects],
                query_tokens: queryTokens,
                eligible_records: scored.length,
                candidate_records: candidates.length,
                shortlist_before_floor: shortlistBase.length,
                relevance_floor: policy.floor,
                shortlist_records: shortlistBase.filter((item, index) => index < policy.minimumKeep || item.normalizedScore >= policy.floor).length,
                selected_records: selected.length,
                per_document_limit: policy.perDocumentLimit,
                provider: 'local-typescript'
            }
        };
    }

    public async retrieve(
        query: string,
        mode: RetrievalMode,
        cancellationToken?: vscode.CancellationToken,
        finalK?: number
    ): Promise<RetrievalResponse> {
        const totalStarted = nowMs();
        const loadStarted = nowMs();
        await this.ensureLoaded();
        const loadMs = nowMs() - loadStarted;
        if (cancellationToken?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const { selected, parameters, timings, debug } = this.search(query, mode, finalK);
        const packStarted = nowMs();
        const contextPack = buildContextPack(query, selected, parameters.max_context_chars);
        const packMs = nowMs() - packStarted;
        const records: RetrievalRecord[] = selected.map((item, index) => ({
            rank: index + 1,
            score: Number((item.finalScore * 100).toFixed(3)),
            id: item.record.id,
            title: item.record.title,
            topic: item.record.topic,
            subtopics: item.record.subtopics,
            summary: item.record.summary,
            content: item.record.content,
            keywords: item.record.keywords,
            source: item.record.source,
            score_breakdown: Object.fromEntries(
                Object.entries(item.breakdown).map(([key, value]) => [key, Number(value.toFixed(6))])
            )
        }));

        return {
            request_id: crypto.randomUUID(),
            query,
            mode,
            knowledge_file: 'bundled://media/knowledge/knowledge.jsonl',
            knowledge_version: this.knowledgeVersion,
            total_records: this.records?.length ?? 0,
            matched_records: records.length,
            parameters,
            timings: {
                load_ms: Number(loadMs.toFixed(3)),
                candidate_ms: Number(timings.candidate_ms.toFixed(3)),
                rerank_ms: Number(timings.rerank_ms.toFixed(3)),
                pack_ms: Number(packMs.toFixed(3)),
                total_ms: Number((nowMs() - totalStarted).toFixed(3))
            },
            records,
            context_pack: contextPack,
            warnings: records.length ? [] : ['No matching evidence was found.'],
            debug
        };
    }

    public async health(): Promise<HealthResponse> {
        await this.ensureLoaded();
        return {
            status: 'ok',
            version: SERVICE_VERSION,
            records_loaded: this.records?.length ?? 0,
            knowledge_version: this.knowledgeVersion
        };
    }
}
