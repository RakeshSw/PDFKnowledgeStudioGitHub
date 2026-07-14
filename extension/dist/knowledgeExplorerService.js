"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeExplorerService = void 0;
const prompts_1 = require("./prompts");
const DEFAULT_EXPLORER_TOPIC = 'Create an overall map of the major concepts, implementation guidance, profiles, risks, and supporting practices represented in the knowledge base.';
function text(value, fallback = '') {
    const result = String(value ?? '').trim();
    return result || fallback;
}
function stringArray(value, maximum) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map(item => text(item))
        .filter(Boolean)
        .filter((item, index, values) => values.findIndex(candidate => candidate.toLowerCase() === item.toLowerCase()) === index)
        .slice(0, maximum);
}
function slug(value) {
    const normalized = value
        .normalize('NFKD')
        .replace(/[^\x00-\x7F]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return normalized || `concept-${Math.random().toString(36).slice(2, 8)}`;
}
function uniqueSources(sources) {
    const seen = new Set();
    return sources.filter(source => {
        const key = [
            source.document_id,
            source.file_name,
            source.page_start,
            source.page_end,
            source.chunk_index
        ].join(':');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
function evidenceSources(evidence, evidenceNumbers) {
    const selected = evidence.records.filter(record => evidenceNumbers.includes(record.evidenceNumber));
    const fallback = evidence.records.slice(0, 2);
    return uniqueSources((selected.length ? selected : fallback).map(record => record.source));
}
function normalizeEvidenceNumbers(value, evidence) {
    const maximum = evidence.records.length;
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item >= 1 && item <= maximum)
        .filter((item, index, values) => values.indexOf(item) === index)
        .slice(0, 6);
}
function cleanMermaid(value) {
    let source = text(value)
        .replace(/^```(?:mermaid)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    if (!source) {
        return '';
    }
    if (source.length > 9000) {
        source = source.slice(0, 9000);
    }
    const firstLine = source.split(/\r?\n/, 1)[0].trim();
    if (!/^(flowchart|graph|sequenceDiagram|stateDiagram-v2|journey|mindmap)\b/i.test(firstLine)) {
        return '';
    }
    if (/\b(click|href|linkStyle|classDef|style)\b|<[^>]+>|javascript:/i.test(source)) {
        return '';
    }
    return source;
}
function mermaidLabel(value) {
    return value
        .replace(/["[\]{}()<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 54);
}
function mermaidEdgeLabel(value) {
    return value
        .replace(/[|"[\]{}()<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30);
}
function buildMapMermaid(nodes, edges) {
    const lines = ['flowchart TD'];
    for (const node of nodes) {
        lines.push(`    ${node.id}["${mermaidLabel(node.label)}"]`);
    }
    for (const edge of edges) {
        const label = mermaidEdgeLabel(edge.label);
        lines.push(label
            ? `    ${edge.from} -->|${label}| ${edge.to}`
            : `    ${edge.from} --> ${edge.to}`);
    }
    for (const node of nodes) {
        lines.push(`    click ${node.id} exploreKnowledgeNode "Explore ${mermaidLabel(node.label)}"`);
    }
    return lines.join('\n');
}
function buildOverallPlan(topic) {
    const broadTopic = topic.trim() || DEFAULT_EXPLORER_TOPIC;
    const isOverall = !topic.trim() ||
        /\b(overall|entire|whole|all|knowledge base|big picture|map)\b/i.test(topic);
    const retrievalQueries = isOverall
        ? [
            `${broadTopic} core framework concepts functions categories and outcomes`,
            `${broadTopic} implementation guidance organizational profiles current target profiles tiers and informative references`,
            `${broadTopic} specialized risk guidance supply chain enterprise risk management workforce incident response and ransomware`,
            `${broadTopic} relationships between governance identify protect detect respond recover profiles tiers and continuous improvement`
        ]
        : [
            `${broadTopic} overview key concepts and relationships`,
            `${broadTopic} implementation process guidance and practical use`,
            `${broadTopic} related concepts risks profiles and supporting practices`
        ];
    return {
        language: 'English',
        normalizedQuestion: broadTopic,
        standaloneQuestions: [broadTopic],
        retrievalQueries,
        intent: 'general',
        answerDepth: 'detailed',
        ambiguousTerms: [],
        assumptions: []
    };
}
function normalizeMap(raw, topic, language, learningLevel, evidence) {
    const rawNodes = Array.isArray(raw.nodes)
        ? raw.nodes
        : [];
    const nodes = [];
    const usedIds = new Set();
    for (const item of rawNodes.slice(0, 12)) {
        const label = text(item.label);
        if (!label) {
            continue;
        }
        let id = slug(text(item.id, label));
        let suffix = 2;
        while (usedIds.has(id)) {
            id = `${slug(text(item.id, label))}-${suffix}`;
            suffix += 1;
        }
        usedIds.add(id);
        const evidenceNumbers = normalizeEvidenceNumbers(item.evidenceNumbers, evidence);
        nodes.push({
            id,
            label,
            category: text(item.category, 'Supporting').slice(0, 32),
            summary: text(item.summary, `Explore ${label}.`).slice(0, 650),
            explorationQuery: text(item.explorationQuery, `Explain ${label}, why it matters, how it works, and how it relates to the wider knowledge domain.`).slice(0, 500),
            evidenceNumbers,
            sources: evidenceSources(evidence, evidenceNumbers)
        });
    }
    if (nodes.length < 2) {
        for (const record of evidence.records.slice(0, 8)) {
            const label = record.topic || record.title;
            let id = slug(label);
            let suffix = 2;
            while (usedIds.has(id)) {
                id = `${slug(label)}-${suffix}`;
                suffix += 1;
            }
            usedIds.add(id);
            nodes.push({
                id,
                label,
                category: 'Evidence',
                summary: record.summary,
                explorationQuery: `Explain ${label} using the available evidence.`,
                evidenceNumbers: [record.evidenceNumber],
                sources: [record.source]
            });
        }
    }
    if (!nodes.length) {
        throw new Error('No evidence-grounded concepts could be created for the map.');
    }
    const requestedRoot = slug(text(raw.rootNodeId, nodes[0].id));
    const rootNodeId = nodes.some(node => node.id === requestedRoot)
        ? requestedRoot
        : nodes[0].id;
    const validIds = new Set(nodes.map(node => node.id));
    const rawEdges = Array.isArray(raw.edges)
        ? raw.edges
        : [];
    const edges = [];
    const edgeKeys = new Set();
    for (const item of rawEdges.slice(0, 24)) {
        const from = slug(text(item.from));
        const to = slug(text(item.to));
        if (!validIds.has(from) || !validIds.has(to) || from === to) {
            continue;
        }
        const key = `${from}:${to}`;
        if (edgeKeys.has(key)) {
            continue;
        }
        edgeKeys.add(key);
        edges.push({
            from,
            to,
            label: text(item.label, 'relates to').slice(0, 42)
        });
    }
    if (!edges.length) {
        for (const node of nodes) {
            if (node.id !== rootNodeId) {
                edges.push({
                    from: rootNodeId,
                    to: node.id,
                    label: 'includes'
                });
            }
        }
    }
    const rawOrder = stringArray(raw.guidedOrder, nodes.length)
        .map(slug)
        .filter(id => validIds.has(id));
    const guidedOrder = [
        rootNodeId,
        ...rawOrder.filter(id => id !== rootNodeId),
        ...nodes.map(node => node.id).filter(id => id !== rootNodeId && !rawOrder.includes(id))
    ].filter((id, index, values) => values.indexOf(id) === index);
    return {
        title: text(raw.title, 'Knowledge Explorer'),
        overview: text(raw.overview, 'Explore the major evidence-grounded concepts and follow their relationships.'),
        topic: topic.trim() || 'Overall knowledge base',
        language,
        learningLevel,
        rootNodeId,
        nodes,
        edges,
        guidedOrder,
        mermaid: buildMapMermaid(nodes, edges),
        sources: uniqueSources(evidence.records.slice(0, 12).map(record => record.source)),
        knowledgeVersion: evidence.knowledgeVersion,
        generatedAt: new Date().toISOString()
    };
}
function normalizeRelatedConcepts(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const result = [];
    for (const item of value.slice(0, 5)) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const candidate = item;
        const label = text(candidate.label);
        const query = text(candidate.query);
        if (!label || !query) {
            continue;
        }
        result.push({
            label,
            query,
            relationship: text(candidate.relationship, 'Related concept')
        });
    }
    return result;
}
function normalizeKnowledgeCheck(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const item = value;
    const question = text(item.question);
    const options = stringArray(item.options, 4);
    const correctIndex = Number(item.correctIndex);
    const explanation = text(item.explanation);
    if (!question ||
        options.length !== 4 ||
        !Number.isInteger(correctIndex) ||
        correctIndex < 0 ||
        correctIndex > 3) {
        return undefined;
    }
    return {
        question,
        options,
        correctIndex,
        explanation
    };
}
function normalizeNodeDetail(raw, node, evidence) {
    const relatedConcepts = normalizeRelatedConcepts(raw.relatedConcepts);
    const suggestedQuestions = stringArray(raw.suggestedQuestions, 4);
    return {
        nodeId: node.id,
        title: text(raw.title, node.label),
        category: text(raw.category, node.category),
        overview: text(raw.overview, node.summary),
        whyItMatters: text(raw.whyItMatters, 'This concept is part of the broader evidence-grounded knowledge domain.'),
        keyIdeas: stringArray(raw.keyIdeas, 6),
        steps: stringArray(raw.steps, 7),
        commonMisunderstandings: stringArray(raw.commonMisunderstandings, 3),
        relatedConcepts,
        suggestedQuestions,
        visualTitle: text(raw.visualTitle, `${node.label} visual`),
        visualMermaid: cleanMermaid(raw.visualMermaid),
        knowledgeCheck: normalizeKnowledgeCheck(raw.knowledgeCheck),
        sources: uniqueSources(evidence.records.slice(0, 10).map(record => record.source)),
        generatedAt: new Date().toISOString()
    };
}
class KnowledgeExplorerService {
    extensionUri;
    azure;
    orchestrator;
    constructor(extensionUri, azure, orchestrator) {
        this.extensionUri = extensionUri;
        this.azure = azure;
        this.orchestrator = orchestrator;
    }
    async createMap(topic, learningLevel, mode, onProgress, cancellationToken) {
        const mapTopic = topic.trim() || DEFAULT_EXPLORER_TOPIC;
        onProgress('Planning the overall knowledge view...');
        let plannedLanguage = 'English';
        try {
            const languagePlan = await this.orchestrator.plan(mapTopic, [], cancellationToken);
            plannedLanguage = languagePlan.language;
        }
        catch {
            // Use English when the planning call cannot determine a language.
        }
        onProgress('Retrieving broad evidence across the knowledge base...');
        const evidence = await this.orchestrator.retrieveCombined(buildOverallPlan(mapTopic), mode, cancellationToken);
        if (!evidence.records.length) {
            throw new Error('No evidence was retrieved for the Knowledge Explorer map.');
        }
        onProgress('Building the evidence-grounded concept map...');
        const prompt = await (0, prompts_1.loadPrompt)(this.extensionUri, 'knowledge-map.md');
        const raw = await this.azure.completeJson([
            { role: 'system', content: prompt },
            {
                role: 'user',
                content: [
                    'MAP REQUEST',
                    JSON.stringify({
                        topic: mapTopic,
                        learningLevel,
                        language: plannedLanguage,
                        maximumNodes: 12
                    }, null, 2),
                    '',
                    evidence.contextPack
                ].join('\n')
            }
        ], cancellationToken, 1500);
        return normalizeMap(raw, mapTopic, plannedLanguage, learningLevel, evidence);
    }
    async exploreNode(map, nodeId, learningLevel, mode, onProgress, cancellationToken) {
        const node = map.nodes.find(item => item.id === nodeId);
        if (!node) {
            throw new Error(`Knowledge map node was not found: ${nodeId}`);
        }
        onProgress(`Planning the lesson for ${node.label}...`);
        const plan = await this.orchestrator.plan(node.explorationQuery, [map.topic, map.overview], cancellationToken);
        onProgress(`Retrieving evidence for ${node.label}...`);
        const evidence = await this.orchestrator.retrieveCombined({
            ...plan,
            answerDepth: 'detailed'
        }, mode, cancellationToken);
        if (!evidence.records.length) {
            throw new Error(`No matching evidence was found for ${node.label}.`);
        }
        onProgress(`Creating the guided learning card for ${node.label}...`);
        const prompt = await (0, prompts_1.loadPrompt)(this.extensionUri, 'knowledge-node.md');
        const raw = await this.azure.completeJson([
            { role: 'system', content: prompt },
            {
                role: 'user',
                content: [
                    'MAP CONTEXT',
                    JSON.stringify({
                        mapTitle: map.title,
                        mapOverview: map.overview,
                        selectedNode: {
                            id: node.id,
                            label: node.label,
                            category: node.category,
                            summary: node.summary,
                            explorationQuery: node.explorationQuery
                        },
                        learningLevel,
                        language: map.language
                    }, null, 2),
                    '',
                    evidence.contextPack
                ].join('\n')
            }
        ], cancellationToken, 1700);
        return normalizeNodeDetail(raw, node, evidence);
    }
    async exploreQuestion(map, question, learningLevel, mode, onProgress, cancellationToken) {
        const syntheticId = `question-${slug(question)}-${Date.now()}`;
        const syntheticNode = {
            id: syntheticId,
            label: question.replace(/[?!.]+$/, '').slice(0, 80),
            category: 'Deep Dive',
            summary: question,
            explorationQuery: question,
            evidenceNumbers: [],
            sources: []
        };
        const extendedMap = {
            ...map,
            nodes: [...map.nodes, syntheticNode]
        };
        return this.exploreNode(extendedMap, syntheticId, learningLevel, mode, onProgress, cancellationToken);
    }
    initialState() {
        return {
            learningLevel: 'New to the topic',
            retrievalMode: 'deep',
            updatedAt: new Date().toISOString()
        };
    }
}
exports.KnowledgeExplorerService = KnowledgeExplorerService;
//# sourceMappingURL=knowledgeExplorerService.js.map