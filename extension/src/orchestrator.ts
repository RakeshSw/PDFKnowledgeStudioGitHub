import * as vscode from 'vscode';
import { AzureOpenAIClient } from './azureOpenAIClient';
import { getSettings } from './configuration';
import {
    QUERY_PLANNER_PROMPT,
    loadPrompt
} from './prompts';
import { RetrievalClient } from './retrievalClient';
import {
    CombinedEvidence,
    EvidenceItem,
    FollowupSuggestionResponse,
    GroundedAnswerResult,
    QueryPlan,
    RetrievalMode,
    RetrievalRecord
} from './types';

function fallbackPlan(question: string): QueryPlan {
    const parts = question
        .split(/\s+(?:and also|and then|also|then)\s+|[?]\s+(?=[A-Z])/i)
        .map(value => value.trim())
        .filter(value => value.length > 4);

    const standalone = parts.length > 1 ? parts.slice(0, 4) : [question.trim()];
    return {
        language: 'English',
        normalizedQuestion: question.trim(),
        standaloneQuestions: standalone,
        retrievalQueries: standalone,
        intent: /\bhow\b|\bsteps?\b|\bprocess\b|\bimplement\b/i.test(question)
            ? 'process'
            : 'general',
        answerDepth: question.length > 180 || standalone.length > 1 ? 'detailed' : 'standard',
        ambiguousTerms: [],
        assumptions: []
    };
}

function normalizePlan(plan: QueryPlan, question: string, maxQueries: number): QueryPlan {
    const retrievalQueries = [
        ...(Array.isArray(plan.retrievalQueries) ? plan.retrievalQueries : []),
        ...(Array.isArray(plan.standaloneQuestions) ? plan.standaloneQuestions : [])
    ]
        .map(value => String(value).trim())
        .filter(Boolean)
        .filter((value, index, values) =>
            values.findIndex(candidate => candidate.toLowerCase() === value.toLowerCase()) === index
        )
        .slice(0, maxQueries);

    return {
        language: String(plan.language || 'English'),
        normalizedQuestion: String(plan.normalizedQuestion || question).trim(),
        standaloneQuestions: Array.isArray(plan.standaloneQuestions) && plan.standaloneQuestions.length
            ? plan.standaloneQuestions.map(String).map(value => value.trim()).filter(Boolean)
            : [question.trim()],
        retrievalQueries: retrievalQueries.length ? retrievalQueries : [question.trim()],
        intent: plan.intent || 'general',
        answerDepth: plan.answerDepth || 'standard',
        ambiguousTerms: Array.isArray(plan.ambiguousTerms) ? plan.ambiguousTerms.map(String) : [],
        assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.map(String) : []
    };
}

function sourceLabel(record: RetrievalRecord): string {
    const start = record.source.page_start;
    const end = record.source.page_end || start;
    const pages = start === end ? `p. ${start}` : `pp. ${start}-${end}`;
    return `${record.source.file_name}, ${pages}`;
}

function buildCombinedContext(records: EvidenceItem[], question: string): string {
    const header = [
        '# COMBINED RETRIEVAL EVIDENCE',
        `Original question: ${question}`,
        'Use only the evidence below. Cite the exact filename and page range attached to each item.',
        ''
    ].join('\n');

    const maxCharacters = 20000;
    let remaining = maxCharacters - header.length;
    const sections: string[] = [];

    for (const item of records) {
        const metadata = [
            `## Evidence ${item.evidenceNumber}`,
            `Source: ${sourceLabel(item)}`,
            `Record ID: ${item.id}`,
            `Retrieval query: ${item.retrievalQuery}`,
            `Relevance: ${item.score}`,
            `Title: ${item.title}`,
            `Topic: ${item.topic}`,
            `Summary: ${item.summary}`,
            'Content:'
        ].join('\n');

        const fairShare = Math.max(
            1400,
            Math.floor(remaining / Math.max(records.length - sections.length, 1))
        );
        const contentBudget = Math.max(500, fairShare - metadata.length - 80);
        const content = (item.content ?? '').slice(0, contentBudget);
        const suffix = (item.content?.length ?? 0) > content.length
            ? '\n[Evidence excerpt truncated]'
            : '';
        const block = `${metadata}\n${content}${suffix}\n`;

        if (block.length > remaining) {
            break;
        }
        sections.push(block);
        remaining -= block.length;
    }

    return header + sections.join('\n');
}

function normalizeSuggestedQuestions(
    questions: unknown,
    originalQuestion: string
): string[] {
    if (!Array.isArray(questions)) {
        return [];
    }

    const original = originalQuestion.trim().toLowerCase();
    return questions
        .map(value => String(value).replace(/^[-*\d.)\s]+/, '').trim())
        .filter(value => value.length >= 8 && value.length <= 180)
        .filter(value => value.toLowerCase() !== original)
        .filter((value, index, values) =>
            values.findIndex(candidate => candidate.toLowerCase() === value.toLowerCase()) === index
        )
        .slice(0, 4);
}

function fallbackSuggestedQuestions(
    originalQuestion: string,
    plan: QueryPlan,
    evidence: CombinedEvidence
): string[] {
    const candidates: string[] = [];

    for (const question of plan.standaloneQuestions.slice(1)) {
        candidates.push(question);
    }

    const firstTopic = evidence.records.find(record => record.topic)?.topic;
    const subtopics = evidence.records
        .flatMap(record => record.subtopics ?? [])
        .map(value => value.trim())
        .filter(Boolean);

    if (firstTopic) {
        candidates.push(`What are the practical implementation steps for ${firstTopic}?`);
        candidates.push(`How does ${firstTopic} relate to the broader framework?`);
    }
    if (subtopics[0]) {
        candidates.push(`Can you explain ${subtopics[0]} in more detail?`);
    }
    if (subtopics[1]) {
        candidates.push(`What is the difference between ${subtopics[0]} and ${subtopics[1]}?`);
    }
    candidates.push(`Which sources provide the strongest evidence for this topic?`);

    return normalizeSuggestedQuestions(candidates, originalQuestion);
}

export class KnowledgeOrchestrator {
    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly azure: AzureOpenAIClient,
        private readonly retrieval: RetrievalClient
    ) {}

    public async plan(
        question: string,
        historyQuestions: string[],
        cancellationToken?: vscode.CancellationToken
    ): Promise<QueryPlan> {
        const settings = getSettings();
        try {
            const plan = await this.azure.completeJson<QueryPlan>(
                [
                    { role: 'system', content: QUERY_PLANNER_PROMPT },
                    {
                        role: 'user',
                        content: JSON.stringify(
                            {
                                recentQuestionHistory: historyQuestions.slice(-6),
                                currentQuestion: question,
                                maximumRetrievalQueries: settings.retrieval.maxCompoundQueries
                            },
                            null,
                            2
                        )
                    }
                ],
                cancellationToken,
                650
            );
            return normalizePlan(plan, question, settings.retrieval.maxCompoundQueries);
        } catch {
            return fallbackPlan(question);
        }
    }

    public async retrieveCombined(
        plan: QueryPlan,
        mode: RetrievalMode,
        cancellationToken?: vscode.CancellationToken
    ): Promise<CombinedEvidence> {
        const responses = await Promise.all(
            plan.retrievalQueries.map(query =>
                this.retrieval.retrieve(query, mode, cancellationToken)
            )
        );

        const byId = new Map<string, EvidenceItem>();
        responses.forEach((response, responseIndex) => {
            const retrievalQuery = plan.retrievalQueries[responseIndex];
            response.records.forEach(record => {
                const existing = byId.get(record.id);
                if (!existing || record.score > existing.score) {
                    byId.set(record.id, {
                        ...record,
                        retrievalQuery,
                        evidenceNumber: 0
                    });
                }
            });
        });

        const limit = mode === 'deep' ? 22 : 12;
        const records = [...byId.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((record, index) => ({ ...record, evidenceNumber: index + 1 }));

        return {
            records,
            contextPack: buildCombinedContext(records, plan.normalizedQuestion),
            requestIds: responses.map(value => value.request_id),
            warnings: responses.flatMap(value => value.warnings),
            knowledgeVersion: responses[0]?.knowledge_version ?? '',
            totalRetrievalMs: responses.reduce((sum, value) => sum + value.timings.total_ms, 0)
        };
    }

    public async suggestQuestions(
        originalQuestion: string,
        _answer: string,
        plan: QueryPlan,
        evidence: CombinedEvidence,
        _cancellationToken?: vscode.CancellationToken
    ): Promise<string[]> {
        // Keep follow-up suggestions local for predictable latency and to avoid a
        // third Azure request for every chat question.
        return fallbackSuggestedQuestions(originalQuestion, plan, evidence);
    }

    public async answer(
        question: string,
        historyQuestions: string[],
        mode: RetrievalMode,
        cancellationToken?: vscode.CancellationToken
    ): Promise<GroundedAnswerResult> {
        const plan = await this.plan(question, historyQuestions, cancellationToken);
        const evidence = await this.retrieveCombined(plan, mode, cancellationToken);

        if (!evidence.records.length) {
            const answer = '### Direct Answer\n\n**Missing from the available evidence.** No matching PDF evidence was retrieved for this question.';
            return {
                answer,
                plan,
                evidence,
                suggestedQuestions: fallbackSuggestedQuestions(question, plan, evidence)
            };
        }

        const systemPrompt = await loadPrompt(this.extensionUri, 'knowledge-assistant.md');
        const answer = await this.azure.complete(
            [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: [
                        'QUERY PLAN',
                        JSON.stringify(plan, null, 2),
                        '',
                        evidence.contextPack
                    ].join('\n')
                }
            ],
            {
                temperature: 0.1,
                maxTokens: plan.answerDepth === 'detailed' ? 1800 : 1200
            },
            cancellationToken
        );

        const suggestedQuestions = await this.suggestQuestions(
            question,
            answer,
            plan,
            evidence,
            cancellationToken
        );

        return { answer, plan, evidence, suggestedQuestions };
    }
}
