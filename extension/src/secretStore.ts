import * as vscode from 'vscode';

const AZURE_API_KEY = 'pdfKnowledge.azureOpenAI.apiKey';

export class SecretStore {
    public constructor(private readonly secrets: vscode.SecretStorage) {}

    public getAzureApiKey(): Thenable<string | undefined> {
        return this.secrets.get(AZURE_API_KEY);
    }

    public async requireAzureApiKey(): Promise<string> {
        const value = (await this.getAzureApiKey())?.trim();
        if (!value) {
            throw new Error('Azure OpenAI API key is not configured. Run "PDF Knowledge: Configure Azure OpenAI".');
        }
        return value;
    }

    public async storeAzureApiKey(value: string): Promise<void> {
        await this.secrets.store(AZURE_API_KEY, value.trim());
    }

    public async clear(): Promise<void> {
        await this.secrets.delete(AZURE_API_KEY);
    }
}
