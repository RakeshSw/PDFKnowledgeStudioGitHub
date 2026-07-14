"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentService = void 0;
const configuration_1 = require("./configuration");
const prompts_1 = require("./prompts");
function slug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'section';
}
function normalizePlan(plan, prompt, maxSections) {
    const sections = (Array.isArray(plan.sections) ? plan.sections : [])
        .slice(0, maxSections)
        .map((section, index) => ({
        id: String(section.id || slug(section.title || `section-${index + 1}`)),
        title: String(section.title || `Section ${index + 1}`),
        purpose: String(section.purpose || ''),
        retrievalQueries: Array.isArray(section.retrievalQueries)
            ? section.retrievalQueries.map(String).map(value => value.trim()).filter(Boolean).slice(0, 3)
            : [String(section.title || prompt)],
        targetLength: section.targetLength || 'medium'
    }));
    if (!sections.length) {
        sections.push({
            id: 'overview',
            title: 'Overview',
            purpose: `Explain ${prompt}`,
            retrievalQueries: [prompt],
            targetLength: 'long'
        });
    }
    return {
        title: String(plan.title || 'Evidence-Grounded Document'),
        language: String(plan.language || 'English'),
        audience: String(plan.audience || 'General professional audience'),
        documentType: String(plan.documentType || 'report'),
        objective: String(plan.objective || prompt),
        sections
    };
}
function uniqueSources(sources) {
    const seen = new Set();
    return sources.filter(source => {
        const key = `${source.file_name}:${source.page_start}:${source.page_end}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
function sourceCitation(source) {
    const pages = source.page_start === source.page_end
        ? `p. ${source.page_start}`
        : `pp. ${source.page_start}-${source.page_end}`;
    return `[Source: ${source.file_name}, ${pages}]`;
}
function renderSourceIndex(sections) {
    const sources = uniqueSources(sections.flatMap(section => section.sources));
    if (!sources.length) {
        return '';
    }
    return [
        '## Source Index',
        '',
        ...sources.map(source => {
            const pages = source.page_start === source.page_end
                ? `p. ${source.page_start}`
                : `pp. ${source.page_start}-${source.page_end}`;
            return `- ${source.file_name}, ${pages}`;
        })
    ].join('\n');
}
function renderDocument(state) {
    const frontMatter = [
        `# ${state.title}`,
        '',
        `**Document type:** ${state.documentType}  `,
        `**Audience:** ${state.audience}  `,
        `**Objective:** ${state.objective}  `,
        `**Generated:** ${state.updatedAt}`,
        ''
    ].join('\n');
    const body = state.sections
        .map(section => `## ${section.title}\n\n${section.markdown.trim()}`)
        .join('\n\n');
    const sourceIndex = renderSourceIndex(state.sections);
    return `${frontMatter}${body}${sourceIndex ? `\n\n${sourceIndex}` : ''}\n`;
}
function appendSectionToEditedMarkdown(existingMarkdown, section, allSections) {
    const sourceMarker = '\n## Source Index';
    const markerIndex = existingMarkdown.indexOf(sourceMarker);
    const editableBody = (markerIndex >= 0
        ? existingMarkdown.slice(0, markerIndex)
        : existingMarkdown).trimEnd();
    const sourceIndex = renderSourceIndex(allSections);
    return [
        editableBody,
        `## ${section.title}`,
        '',
        section.markdown.trim(),
        '',
        sourceIndex
    ].filter((value, index, values) => value || index < values.length - 1).join('\n\n').trim() + '\n';
}
function cleanMermaidSource(value) {
    const cleaned = String(value ?? '')
        .replace(/^```(?:mermaid)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .split(/\r?\n/)
        .filter(line => !/^\s*%%\{.*\}%%\s*$/.test(line))
        .join('\n')
        .trim();
    if (!cleaned) {
        throw new Error('Azure OpenAI returned an empty Mermaid diagram.');
    }
    if (cleaned.length > 14000) {
        throw new Error('The generated Mermaid diagram is too large. Try a more focused visual request.');
    }
    const firstLine = cleaned.split(/\r?\n/, 1)[0].trim();
    const allowed = /^(?:flowchart\s+(?:TD|TB|BT|LR|RL)|graph\s+(?:TD|TB|BT|LR|RL)|sequenceDiagram|stateDiagram-v2|mindmap|classDiagram)\b/i;
    if (!allowed.test(firstLine)) {
        throw new Error(`Unsupported Mermaid diagram type: ${firstLine}`);
    }
    if (/\bclick\b|javascript:|<script|<iframe|<img/i.test(cleaned)) {
        throw new Error('The generated Mermaid diagram contained unsupported interactive or HTML content.');
    }
    return cleaned;
}
function ensureDiagramExplanationCitations(explanation, sources) {
    const normalized = String(explanation ?? '').trim();
    if (/\[Source:\s*[^\]]+\]/i.test(normalized) || !sources.length) {
        return normalized;
    }
    const citations = sources.slice(0, 4).map(sourceCitation).join(' ');
    return `${normalized}\n\n${citations}`.trim();
}
class DocumentService {
    extensionUri;
    azure;
    orchestrator;
    constructor(extensionUri, azure, orchestrator) {
        this.extensionUri = extensionUri;
        this.azure = azure;
        this.orchestrator = orchestrator;
    }
    async createPlan(prompt, audience, documentType, cancellationToken) {
        const maxSections = (0, configuration_1.getSettings)().document.maxSections;
        const plan = await this.azure.completeJson([
            { role: 'system', content: prompts_1.DOCUMENT_PLANNER_PROMPT },
            {
                role: 'user',
                content: JSON.stringify({
                    request: prompt,
                    requestedAudience: audience || 'General professional audience',
                    requestedDocumentType: documentType || 'report',
                    maximumSections: maxSections
                }, null, 2)
            }
        ], cancellationToken, 900);
        return normalizePlan(plan, prompt, maxSections);
    }
    async generate(prompt, audience, documentType, mode, onProgress, cancellationToken) {
        onProgress('Planning the document...');
        const plan = await this.createPlan(prompt, audience, documentType, cancellationToken);
        const writerPrompt = await (0, prompts_1.loadPrompt)(this.extensionUri, 'document-builder.md');
        const sections = [];
        for (let index = 0; index < plan.sections.length; index += 1) {
            const section = plan.sections[index];
            onProgress(`Retrieving evidence for ${index + 1}/${plan.sections.length}: ${section.title}`);
            const queryPlan = {
                language: plan.language,
                normalizedQuestion: section.retrievalQueries[0] || section.title,
                standaloneQuestions: section.retrievalQueries,
                retrievalQueries: section.retrievalQueries,
                intent: 'document',
                answerDepth: section.targetLength === 'long' ? 'detailed' : 'standard',
                ambiguousTerms: [],
                assumptions: []
            };
            const evidence = await this.orchestrator.retrieveCombined(queryPlan, mode, cancellationToken);
            onProgress(`Writing ${index + 1}/${plan.sections.length}: ${section.title}`);
            const markdown = evidence.records.length
                ? await this.azure.complete([
                    { role: 'system', content: writerPrompt },
                    {
                        role: 'user',
                        content: [
                            'DOCUMENT PLAN',
                            JSON.stringify(plan, null, 2),
                            '',
                            'CURRENT SECTION',
                            JSON.stringify(section, null, 2),
                            '',
                            evidence.contextPack
                        ].join('\n')
                    }
                ], {
                    temperature: 0.1,
                    maxTokens: section.targetLength === 'long' ? 2200 : 1600
                }, cancellationToken)
                : '**Missing from the available evidence.**';
            sections.push({
                id: section.id,
                title: section.title,
                markdown,
                sources: uniqueSources(evidence.records.map(record => record.source)),
                kind: 'content'
            });
        }
        const base = {
            title: plan.title,
            language: plan.language,
            audience: plan.audience,
            documentType: plan.documentType,
            objective: plan.objective,
            originalPrompt: prompt,
            sections,
            updatedAt: new Date().toISOString()
        };
        return { ...base, markdown: renderDocument(base) };
    }
    async addSection(state, request, mode, onProgress, cancellationToken) {
        onProgress('Planning the additional section...');
        const sectionPlan = await this.azure.completeJson([
            {
                role: 'system',
                content: `${prompts_1.DOCUMENT_PLANNER_PROMPT}\nReturn one section object only, matching the section schema.`
            },
            {
                role: 'user',
                content: JSON.stringify({
                    documentTitle: state.title,
                    documentObjective: state.objective,
                    existingSections: state.sections.map(section => section.title),
                    requestedAdditionalSection: request,
                    language: state.language
                }, null, 2)
            }
        ], cancellationToken, 700);
        const normalized = {
            id: String(sectionPlan.id || slug(sectionPlan.title || request)),
            title: String(sectionPlan.title || request),
            purpose: String(sectionPlan.purpose || request),
            retrievalQueries: Array.isArray(sectionPlan.retrievalQueries) && sectionPlan.retrievalQueries.length
                ? sectionPlan.retrievalQueries.map(String).slice(0, 3)
                : [request],
            targetLength: sectionPlan.targetLength || 'medium'
        };
        onProgress(`Retrieving evidence for ${normalized.title}...`);
        const evidence = await this.orchestrator.retrieveCombined({
            language: state.language,
            normalizedQuestion: normalized.retrievalQueries[0],
            standaloneQuestions: normalized.retrievalQueries,
            retrievalQueries: normalized.retrievalQueries,
            intent: 'document',
            answerDepth: normalized.targetLength === 'long' ? 'detailed' : 'standard',
            ambiguousTerms: [],
            assumptions: []
        }, mode, cancellationToken);
        onProgress(`Writing ${normalized.title}...`);
        const writerPrompt = await (0, prompts_1.loadPrompt)(this.extensionUri, 'document-builder.md');
        const markdown = evidence.records.length
            ? await this.azure.complete([
                { role: 'system', content: writerPrompt },
                {
                    role: 'user',
                    content: [
                        'EXISTING DOCUMENT',
                        state.markdown.slice(0, 18000),
                        '',
                        'ADDITIONAL SECTION',
                        JSON.stringify(normalized, null, 2),
                        '',
                        evidence.contextPack
                    ].join('\n')
                }
            ], { temperature: 0.1, maxTokens: 1800 }, cancellationToken)
            : '**Missing from the available evidence.**';
        const newSection = {
            id: normalized.id,
            title: normalized.title,
            markdown,
            sources: uniqueSources(evidence.records.map(record => record.source)),
            kind: 'content'
        };
        const sections = [...state.sections, newSection];
        const base = {
            ...state,
            sections,
            updatedAt: new Date().toISOString()
        };
        return {
            ...base,
            markdown: appendSectionToEditedMarkdown(state.markdown, newSection, sections)
        };
    }
    async addDiagram(state, request, mode, onProgress, cancellationToken) {
        const visualRequest = request.trim() ||
            `Create a visual explanation of the main process, hierarchy, or relationships in ${state.objective}`;
        onProgress('Planning the visual explanation...');
        const queryPlan = await this.orchestrator.plan(visualRequest, [state.originalPrompt, state.objective], cancellationToken);
        onProgress('Retrieving evidence for the diagram...');
        const evidence = await this.orchestrator.retrieveCombined(queryPlan, mode, cancellationToken);
        if (!evidence.records.length) {
            throw new Error('No matching evidence was found for the requested visual explanation.');
        }
        onProgress('Generating the Mermaid diagram...');
        const diagramPrompt = await (0, prompts_1.loadPrompt)(this.extensionUri, 'mermaid-diagram.md');
        const result = await this.azure.completeJson([
            { role: 'system', content: diagramPrompt },
            {
                role: 'user',
                content: [
                    'DOCUMENT CONTEXT',
                    JSON.stringify({
                        title: state.title,
                        language: state.language,
                        audience: state.audience,
                        objective: state.objective,
                        existingSectionTitles: state.sections.map(section => section.title),
                        visualRequest
                    }, null, 2),
                    '',
                    'CURRENT DOCUMENT EXCERPT',
                    state.markdown.slice(0, 16000),
                    '',
                    evidence.contextPack
                ].join('\n')
            }
        ], cancellationToken, 1200);
        const mermaid = cleanMermaidSource(result.mermaid);
        const sources = uniqueSources(evidence.records.map(record => record.source));
        const explanation = ensureDiagramExplanationCitations(result.explanation, sources);
        const title = String(result.title || 'Visual Explanation').trim();
        const markdown = [
            '```mermaid',
            mermaid,
            '```',
            '',
            explanation || sources.slice(0, 4).map(sourceCitation).join(' ')
        ].join('\n').trim();
        const newSection = {
            id: `visual-${slug(title)}-${Date.now()}`,
            title,
            markdown,
            sources,
            kind: 'diagram'
        };
        const sections = [...state.sections, newSection];
        const base = {
            ...state,
            sections,
            updatedAt: new Date().toISOString()
        };
        return {
            ...base,
            markdown: appendSectionToEditedMarkdown(state.markdown, newSection, sections)
        };
    }
    rebuildFromEditedMarkdown(state, markdown) {
        return {
            ...state,
            markdown,
            updatedAt: new Date().toISOString()
        };
    }
}
exports.DocumentService = DocumentService;
//# sourceMappingURL=documentService.js.map