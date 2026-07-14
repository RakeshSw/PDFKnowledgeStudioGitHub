import * as vscode from 'vscode';
import { AzureOpenAIClient } from './azureOpenAIClient';
import { registerCommands, testConnections } from './commands';
import { getSettings } from './configuration';
import { DocumentService } from './documentService';
import { KnowledgeOrchestrator } from './orchestrator';
import { KnowledgeExplorerService } from './knowledgeExplorerService';
import { RetrievalClient } from './retrievalClient';
import { SecretStore } from './secretStore';
import { ChatMetadata, RetrievalMode } from './types';

interface PdfChatResult extends vscode.ChatResult {
    metadata: ChatMetadata;
}

function historyQuestions(context: vscode.ChatContext): string[] {
    return context.history
        .filter(item => item instanceof vscode.ChatRequestTurn)
        .map(item => (item as vscode.ChatRequestTurn).prompt)
        .filter(Boolean)
        .slice(-6);
}

function sourceTable(records: Array<{
    rank: number;
    score: number;
    title: string;
    summary: string;
    source: { file_name: string; page_start: number; page_end: number };
}>): string {
    if (!records.length) {
        return '**No matching evidence was found.**';
    }

    const lines = [
        '| Rank | Relevance | Source | Pages | Evidence |',
        '|---:|---:|---|---:|---|'
    ];
    records.forEach(record => {
        const pages = record.source.page_start === record.source.page_end
            ? String(record.source.page_start)
            : `${record.source.page_start}-${record.source.page_end}`;
        const safeTitle = record.title.replace(/\|/g, '\\|');
        const safeSummary = record.summary.replace(/\|/g, '\\|').slice(0, 240);
        lines.push(
            `| ${record.rank} | ${record.score.toFixed(1)} | ${record.source.file_name} | ${pages} | **${safeTitle}** — ${safeSummary} |`
        );
    });
    return lines.join('\n');
}

async function streamMarkdown(
    stream: vscode.ChatResponseStream,
    markdown: string
): Promise<void> {
    const blocks = markdown.split(/(\n\n+)/);
    for (const block of blocks) {
        stream.markdown(block);
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

function emptyMetadata(prompt: string, command: string): ChatMetadata {
    return {
        originalPrompt: prompt,
        command,
        sources: [],
        language: 'English',
        suggestedQuestions: []
    };
}

function followupLabel(question: string): string {
    return question.length <= 78 ? question : `${question.slice(0, 75).trimEnd()}…`;
}

export function activate(context: vscode.ExtensionContext): void {
    const secretStore = new SecretStore(context.secrets);
    const azure = new AzureOpenAIClient(secretStore);
    const retrieval = new RetrievalClient(context.extensionUri);
    const orchestrator = new KnowledgeOrchestrator(context.extensionUri, azure, retrieval);
    const documentService = new DocumentService(context.extensionUri, azure, orchestrator);
    const explorerService = new KnowledgeExplorerService(context.extensionUri, azure, orchestrator);

    registerCommands(context, secretStore, retrieval, azure, documentService, explorerService);

    const handler: vscode.ChatRequestHandler = async (
        request,
        chatContext,
        stream,
        token
    ): Promise<PdfChatResult> => {
        const command = request.command ?? 'ask';
        const prompt = request.prompt.trim();

        try {
            if (command === 'health') {
                stream.progress('Testing bundled local retrieval and Azure OpenAI...');
                await testConnections(retrieval, azure);
                stream.markdown('**Ready.** Bundled local retrieval and Azure OpenAI are available.');
                return { metadata: emptyMetadata(prompt, command) };
            }

            if (command === 'document') {
                await vscode.commands.executeCommand('pdfKnowledge.openDocumentBuilder', prompt);
                stream.markdown('Document Builder opened with your request.');
                return { metadata: emptyMetadata(prompt, command) };
            }

            if (command === 'explore') {
                await vscode.commands.executeCommand('pdfKnowledge.openKnowledgeExplorer', prompt);
                stream.markdown('Knowledge Explorer opened with an evidence-grounded concept map and guided learning path.');
                return { metadata: emptyMetadata(prompt, command) };
            }

            if (!prompt) {
                stream.markdown(
                    'Ask a question after `@pdf-knowledge`, or use `/document` to open the Document Builder.'
                );
                return { metadata: emptyMetadata('', command) };
            }

            const mode: RetrievalMode =
                command === 'fast'
                    ? 'fast'
                    : command === 'deep'
                        ? 'deep'
                        : getSettings().retrieval.defaultMode;

            stream.progress('Understanding and rewriting the question...');
            const plan = await orchestrator.plan(prompt, historyQuestions(chatContext), token);

            if (getSettings().logging.showPlan) {
                stream.markdown(
                    `\n<details><summary>Query plan</summary>\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n</details>\n\n`
                );
            }

            stream.progress(
                plan.retrievalQueries.length > 1
                    ? `Retrieving evidence for ${plan.retrievalQueries.length} focused questions...`
                    : 'Retrieving the strongest evidence...'
            );
            const evidence = await orchestrator.retrieveCombined(plan, mode, token);
            let answerForSuggestions: string;

            if (command === 'sources') {
                answerForSuggestions = sourceTable(evidence.records);
                await streamMarkdown(stream, answerForSuggestions);
            } else {
                stream.progress('Generating the grounded answer...');
                if (!evidence.records.length) {
                    answerForSuggestions =
                        '### Direct Answer\n\n**Missing from the available evidence.** No matching PDF evidence was retrieved.';
                    stream.markdown(answerForSuggestions);
                } else {
                    const systemPromptUri = vscode.Uri.joinPath(
                        context.extensionUri,
                        'prompts',
                        'knowledge-assistant.md'
                    );
                    const systemPrompt = Buffer.from(
                        await vscode.workspace.fs.readFile(systemPromptUri)
                    ).toString('utf8');
                    answerForSuggestions = await azure.complete(
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
                        token
                    );
                    await streamMarkdown(stream, answerForSuggestions);
                }
            }

            stream.progress('Preparing suggested follow-up questions...');
            const suggestedQuestions = await orchestrator.suggestQuestions(
                prompt,
                answerForSuggestions,
                plan,
                evidence,
                token
            );

            stream.button({
                command: 'pdfKnowledge.openDocumentBuilder',
                title: 'Build a document from this',
                arguments: [prompt]
            });
            stream.button({
                command: 'pdfKnowledge.openKnowledgeExplorer',
                title: 'Explore this visually',
                arguments: [prompt]
            });

            return {
                metadata: {
                    originalPrompt: prompt,
                    command,
                    sources: evidence.records.map(record => record.source),
                    language: plan.language,
                    suggestedQuestions
                }
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            stream.markdown(`**PDF Knowledge request failed:** ${message}`);
            stream.button({
                command: 'pdfKnowledge.configure',
                title: 'Configure Azure OpenAI'
            });
            return { metadata: emptyMetadata(prompt, command) };
        }
    };

    const participant = vscode.chat.createChatParticipant(
        'pdfKnowledge.assistant',
        handler
    );

    participant.followupProvider = {
        provideFollowups(result: PdfChatResult): vscode.ChatFollowup[] {
            if (!result.metadata.originalPrompt) {
                return [];
            }

            const dynamicFollowups = result.metadata.suggestedQuestions
                .slice(0, 4)
                .map(question => ({
                    prompt: question,
                    label: followupLabel(question),
                    command: 'ask'
                } satisfies vscode.ChatFollowup));

            return [
                ...dynamicFollowups,
                {
                    prompt: result.metadata.originalPrompt,
                    label: 'Create a document from this',
                    command: 'document'
                },
                {
                    prompt: result.metadata.originalPrompt,
                    label: 'Explore this as a knowledge map',
                    command: 'explore'
                }
            ];
        }
    };

    context.subscriptions.push(participant);
}

export function deactivate(): void {
    // No background resources.
}
