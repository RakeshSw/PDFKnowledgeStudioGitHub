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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const azureOpenAIClient_1 = require("./azureOpenAIClient");
const commands_1 = require("./commands");
const configuration_1 = require("./configuration");
const documentService_1 = require("./documentService");
const orchestrator_1 = require("./orchestrator");
const knowledgeExplorerService_1 = require("./knowledgeExplorerService");
const retrievalClient_1 = require("./retrievalClient");
const secretStore_1 = require("./secretStore");
function historyQuestions(context) {
    return context.history
        .filter(item => item instanceof vscode.ChatRequestTurn)
        .map(item => item.prompt)
        .filter(Boolean)
        .slice(-6);
}
function sourceTable(records) {
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
        lines.push(`| ${record.rank} | ${record.score.toFixed(1)} | ${record.source.file_name} | ${pages} | **${safeTitle}** — ${safeSummary} |`);
    });
    return lines.join('\n');
}
async function streamMarkdown(stream, markdown) {
    const blocks = markdown.split(/(\n\n+)/);
    for (const block of blocks) {
        stream.markdown(block);
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}
function emptyMetadata(prompt, command) {
    return {
        originalPrompt: prompt,
        command,
        sources: [],
        language: 'English',
        suggestedQuestions: []
    };
}
function followupLabel(question) {
    return question.length <= 78 ? question : `${question.slice(0, 75).trimEnd()}…`;
}
function activate(context) {
    const secretStore = new secretStore_1.SecretStore(context.secrets);
    const azure = new azureOpenAIClient_1.AzureOpenAIClient(secretStore);
    const retrieval = new retrievalClient_1.RetrievalClient(context.extensionUri);
    const orchestrator = new orchestrator_1.KnowledgeOrchestrator(context.extensionUri, azure, retrieval);
    const documentService = new documentService_1.DocumentService(context.extensionUri, azure, orchestrator);
    const explorerService = new knowledgeExplorerService_1.KnowledgeExplorerService(context.extensionUri, azure, orchestrator);
    (0, commands_1.registerCommands)(context, secretStore, retrieval, azure, documentService, explorerService);
    const handler = async (request, chatContext, stream, token) => {
        const command = request.command ?? 'ask';
        const prompt = request.prompt.trim();
        try {
            if (command === 'health') {
                stream.progress('Testing bundled local retrieval and Azure OpenAI...');
                await (0, commands_1.testConnections)(retrieval, azure);
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
                stream.markdown('Ask a question after `@pdf-knowledge`, or use `/document` to open the Document Builder.');
                return { metadata: emptyMetadata('', command) };
            }
            const mode = command === 'fast'
                ? 'fast'
                : command === 'deep'
                    ? 'deep'
                    : (0, configuration_1.getSettings)().retrieval.defaultMode;
            stream.progress('Understanding and rewriting the question...');
            const plan = await orchestrator.plan(prompt, historyQuestions(chatContext), token);
            if ((0, configuration_1.getSettings)().logging.showPlan) {
                stream.markdown(`\n<details><summary>Query plan</summary>\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n</details>\n\n`);
            }
            stream.progress(plan.retrievalQueries.length > 1
                ? `Retrieving evidence for ${plan.retrievalQueries.length} focused questions...`
                : 'Retrieving the strongest evidence...');
            const evidence = await orchestrator.retrieveCombined(plan, mode, token);
            let answerForSuggestions;
            if (command === 'sources') {
                answerForSuggestions = sourceTable(evidence.records);
                await streamMarkdown(stream, answerForSuggestions);
            }
            else {
                stream.progress('Generating the grounded answer...');
                if (!evidence.records.length) {
                    answerForSuggestions =
                        '### Direct Answer\n\n**Missing from the available evidence.** No matching PDF evidence was retrieved.';
                    stream.markdown(answerForSuggestions);
                }
                else {
                    const systemPromptUri = vscode.Uri.joinPath(context.extensionUri, 'prompts', 'knowledge-assistant.md');
                    const systemPrompt = Buffer.from(await vscode.workspace.fs.readFile(systemPromptUri)).toString('utf8');
                    answerForSuggestions = await azure.complete([
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
                    ], {
                        temperature: 0.1,
                        maxTokens: plan.answerDepth === 'detailed' ? 1800 : 1200
                    }, token);
                    await streamMarkdown(stream, answerForSuggestions);
                }
            }
            stream.progress('Preparing suggested follow-up questions...');
            const suggestedQuestions = await orchestrator.suggestQuestions(prompt, answerForSuggestions, plan, evidence, token);
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            stream.markdown(`**PDF Knowledge request failed:** ${message}`);
            stream.button({
                command: 'pdfKnowledge.configure',
                title: 'Configure Azure OpenAI'
            });
            return { metadata: emptyMetadata(prompt, command) };
        }
    };
    const participant = vscode.chat.createChatParticipant('pdfKnowledge.assistant', handler);
    participant.followupProvider = {
        provideFollowups(result) {
            if (!result.metadata.originalPrompt) {
                return [];
            }
            const dynamicFollowups = result.metadata.suggestedQuestions
                .slice(0, 4)
                .map(question => ({
                prompt: question,
                label: followupLabel(question),
                command: 'ask'
            }));
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
function deactivate() {
    // No background resources.
}
//# sourceMappingURL=extension.js.map