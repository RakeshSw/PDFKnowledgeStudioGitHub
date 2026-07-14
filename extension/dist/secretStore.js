"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretStore = void 0;
const AZURE_API_KEY = 'pdfKnowledge.azureOpenAI.apiKey';
class SecretStore {
    secrets;
    constructor(secrets) {
        this.secrets = secrets;
    }
    getAzureApiKey() {
        return this.secrets.get(AZURE_API_KEY);
    }
    async requireAzureApiKey() {
        const value = (await this.getAzureApiKey())?.trim();
        if (!value) {
            throw new Error('Azure OpenAI API key is not configured. Run "PDF Knowledge: Configure Azure OpenAI".');
        }
        return value;
    }
    async storeAzureApiKey(value) {
        await this.secrets.store(AZURE_API_KEY, value.trim());
    }
    async clear() {
        await this.secrets.delete(AZURE_API_KEY);
    }
}
exports.SecretStore = SecretStore;
//# sourceMappingURL=secretStore.js.map