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
exports.configureConnections = configureConnections;
exports.testConnections = testConnections;
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const documentBuilderPanel_1 = require("./documentBuilderPanel");
const knowledgeExplorerPanel_1 = require("./knowledgeExplorerPanel");
async function configureConnections(secretStore) {
    const config = vscode.workspace.getConfiguration('pdfKnowledge');
    const endpoint = await vscode.window.showInputBox({
        title: 'Azure OpenAI Endpoint',
        prompt: 'Example: https://your-resource-name.openai.azure.com',
        value: (config.get('azure.endpoint') ?? '').trim(),
        ignoreFocusOut: true,
        validateInput: (value) => {
            const normalized = value.trim();
            if (!normalized) {
                return 'The Azure OpenAI endpoint is required.';
            }
            try {
                const parsed = new URL(normalized);
                if (parsed.protocol !== 'https:') {
                    return 'Use an HTTPS Azure OpenAI endpoint.';
                }
            }
            catch {
                return 'Enter a valid Azure OpenAI endpoint URL.';
            }
            return undefined;
        }
    });
    if (!endpoint) {
        return;
    }
    const deployment = await vscode.window.showInputBox({
        title: 'Azure OpenAI Deployment Name',
        prompt: 'Enter the deployment name created in your Azure OpenAI resource.',
        value: (config.get('azure.deployment') ?? '').trim(),
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : 'The deployment name is required.'
    });
    if (!deployment) {
        return;
    }
    const apiVersion = await vscode.window.showInputBox({
        title: 'Azure OpenAI API Version',
        prompt: 'Use an API version supported by your Azure OpenAI resource.',
        value: (config.get('azure.apiVersion') ?? '2024-10-21').trim(),
        ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? undefined : 'The API version is required.'
    });
    if (!apiVersion) {
        return;
    }
    const azureKey = await vscode.window.showInputBox({
        title: 'Azure OpenAI API Key',
        prompt: 'Stored securely in VS Code SecretStorage. It is never written to the repository or knowledge pack.',
        password: true,
        ignoreFocusOut: true
    });
    if (!azureKey) {
        return;
    }
    await Promise.all([
        config.update('azure.endpoint', endpoint.trim().replace(/\/+$/, ''), vscode.ConfigurationTarget.Global),
        config.update('azure.deployment', deployment.trim(), vscode.ConfigurationTarget.Global),
        config.update('azure.apiVersion', apiVersion.trim(), vscode.ConfigurationTarget.Global),
        secretStore.storeAzureApiKey(azureKey)
    ]);
    void vscode.window.showInformationMessage('Azure OpenAI endpoint, deployment, API version, and API key were configured.');
}
async function testConnections(retrieval, azure) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Testing PDF Knowledge',
        cancellable: true
    }, async (progress, token) => {
        progress.report({ message: 'Bundled local knowledge...' });
        const health = await retrieval.health();
        progress.report({ message: 'Azure OpenAI...' });
        await azure.test(token);
        void vscode.window.showInformationMessage(`Ready. Local Retrieval ${health.version}, ${health.records_loaded} records; Azure OpenAI OK.`);
    });
}
function registerCommands(context, secretStore, retrieval, azure, documentService, explorerService) {
    context.subscriptions.push(vscode.commands.registerCommand('pdfKnowledge.configure', () => configureConnections(secretStore)), vscode.commands.registerCommand('pdfKnowledge.testConnections', () => testConnections(retrieval, azure)), vscode.commands.registerCommand('pdfKnowledge.openDocumentBuilder', (prompt) => documentBuilderPanel_1.DocumentBuilderPanel.createOrShow(context, documentService, prompt ?? '')), vscode.commands.registerCommand('pdfKnowledge.openKnowledgeExplorer', (topic) => knowledgeExplorerPanel_1.KnowledgeExplorerPanel.createOrShow(context, explorerService, topic ?? '')), vscode.commands.registerCommand('pdfKnowledge.clearSecrets', async () => {
        await secretStore.clear();
        void vscode.window.showInformationMessage('Stored Azure OpenAI API key was cleared.');
    }));
}
//# sourceMappingURL=commands.js.map