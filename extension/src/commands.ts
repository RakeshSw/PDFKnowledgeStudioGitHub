import * as vscode from 'vscode';
import { AzureOpenAIClient } from './azureOpenAIClient';
import { DocumentBuilderPanel } from './documentBuilderPanel';
import { DocumentService } from './documentService';
import { KnowledgeExplorerPanel } from './knowledgeExplorerPanel';
import { KnowledgeExplorerService } from './knowledgeExplorerService';
import { RetrievalClient } from './retrievalClient';
import { SecretStore } from './secretStore';

export async function configureConnections(secretStore: SecretStore): Promise<void> {
  const config = vscode.workspace.getConfiguration('pdfKnowledge');

  const endpoint = await vscode.window.showInputBox({
    title: 'Azure OpenAI Endpoint',
    prompt: 'Example: https://your-resource-name.openai.azure.com',
    value: (config.get<string>('azure.endpoint') ?? '').trim(),
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
      } catch {
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
    value: (config.get<string>('azure.deployment') ?? '').trim(),
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'The deployment name is required.'
  });

  if (!deployment) {
    return;
  }

  const apiVersion = await vscode.window.showInputBox({
    title: 'Azure OpenAI API Version',
    prompt: 'Use an API version supported by your Azure OpenAI resource.',
    value: (config.get<string>('azure.apiVersion') ?? '2024-10-21').trim(),
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
    config.update(
      'azure.endpoint',
      endpoint.trim().replace(/\/+$/, ''),
      vscode.ConfigurationTarget.Global
    ),
    config.update(
      'azure.deployment',
      deployment.trim(),
      vscode.ConfigurationTarget.Global
    ),
    config.update(
      'azure.apiVersion',
      apiVersion.trim(),
      vscode.ConfigurationTarget.Global
    ),
    secretStore.storeAzureApiKey(azureKey)
  ]);

  void vscode.window.showInformationMessage(
    'Azure OpenAI endpoint, deployment, API version, and API key were configured.'
  );
}
export async function testConnections(
    retrieval: RetrievalClient,
    azure: AzureOpenAIClient
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Testing PDF Knowledge',
            cancellable: true
        },
        async (progress, token) => {
            progress.report({ message: 'Bundled local knowledge...' });
            const health = await retrieval.health();

            progress.report({ message: 'Azure OpenAI...' });
            await azure.test(token);

            void vscode.window.showInformationMessage(
                `Ready. Local Retrieval ${health.version}, ${health.records_loaded} records; Azure OpenAI OK.`
            );
        }
    );
}

export function registerCommands(
    context: vscode.ExtensionContext,
    secretStore: SecretStore,
    retrieval: RetrievalClient,
    azure: AzureOpenAIClient,
    documentService: DocumentService,
    explorerService: KnowledgeExplorerService
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('pdfKnowledge.configure', () =>
            configureConnections(secretStore)
        ),
        vscode.commands.registerCommand('pdfKnowledge.testConnections', () =>
            testConnections(retrieval, azure)
        ),
        vscode.commands.registerCommand('pdfKnowledge.openDocumentBuilder', (prompt?: string) =>
            DocumentBuilderPanel.createOrShow(context, documentService, prompt ?? '')
        ),
        vscode.commands.registerCommand('pdfKnowledge.openKnowledgeExplorer', (topic?: string) =>
            KnowledgeExplorerPanel.createOrShow(context, explorerService, topic ?? '')
        ),
        vscode.commands.registerCommand('pdfKnowledge.clearSecrets', async () => {
            await secretStore.clear();
            void vscode.window.showInformationMessage('Stored Azure OpenAI API key was cleared.');
        })
    );
}
