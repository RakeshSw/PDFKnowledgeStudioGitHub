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
exports.AzureOpenAIClient = void 0;
const vscode = __importStar(require("vscode"));
const configuration_1 = require("./configuration");
const http_1 = require("./http");
function parseDelayMilliseconds(response, attempt) {
    const retryAfterMs = Number(response.headers.get('retry-after-ms'));
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        return Math.min(retryAfterMs, 30000);
    }
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(retryAfterSeconds * 1000, 30000);
    }
    for (const headerName of ['x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests']) {
        const value = response.headers.get(headerName)?.trim();
        const match = value?.match(/^(\d+(?:\.\d+)?)(ms|s)?$/i);
        if (match) {
            const amount = Number(match[1]);
            const delay = match[2]?.toLowerCase() === 'ms' ? amount : amount * 1000;
            if (delay > 0) {
                return Math.min(delay, 30000);
            }
        }
    }
    const schedule = [2000, 5000, 10000, 20000];
    return schedule[Math.min(attempt, schedule.length - 1)];
}
async function delay(milliseconds, cancellationToken) {
    if (cancellationToken?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
    await new Promise((resolve, reject) => {
        let subscription;
        const timer = setTimeout(() => {
            subscription?.dispose();
            resolve();
        }, milliseconds);
        subscription = cancellationToken?.onCancellationRequested(() => {
            clearTimeout(timer);
            subscription?.dispose();
            reject(new vscode.CancellationError());
        });
    });
}
class AzureOpenAIClient {
    secretStore;
    constructor(secretStore) {
        this.secretStore = secretStore;
    }
    async complete(messages, options = {}, cancellationToken) {
        const settings = (0, configuration_1.getSettings)();
        const apiKey = await this.secretStore.requireAzureApiKey();
        const url = `${settings.azure.endpoint}/openai/deployments/` +
            `${encodeURIComponent(settings.azure.deployment)}/chat/completions` +
            `?api-version=${encodeURIComponent(settings.azure.apiVersion)}`;
        const maxRetries = Math.max(0, options.maxRetries ?? 4);
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            const response = await (0, http_1.fetchWithTimeout)(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': apiKey
                },
                body: JSON.stringify({
                    messages,
                    temperature: options.temperature ?? settings.azure.temperature,
                    max_tokens: options.maxTokens ?? settings.azure.maxTokens
                })
            }, settings.azure.timeoutMs, cancellationToken);
            if (response.ok) {
                const payload = (await response.json());
                const content = payload.choices?.[0]?.message?.content?.trim();
                if (!content) {
                    throw new Error('Azure OpenAI returned an empty response.');
                }
                return content;
            }
            const errorText = await (0, http_1.readErrorResponse)(response);
            if (response.status !== 429 || attempt >= maxRetries) {
                const suffix = response.status === 429
                    ? ' The deployment remained rate-limited after automatic retries.'
                    : '';
                throw new Error(`Azure OpenAI request failed: ${errorText}${suffix}`);
            }
            await delay(parseDelayMilliseconds(response, attempt), cancellationToken);
        }
        throw new Error('Azure OpenAI request failed after automatic retries.');
    }
    async completeJson(messages, cancellationToken, maxTokens = 900) {
        const content = await this.complete(messages, { temperature: 0.05, maxTokens }, cancellationToken);
        const cleaned = content
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
        try {
            return JSON.parse(cleaned);
        }
        catch {
            throw new Error(`Azure OpenAI did not return valid JSON. Response: ${cleaned.slice(0, 1200)}`);
        }
    }
    async test(cancellationToken) {
        const result = await this.complete([
            {
                role: 'system',
                content: 'Return only the word OK.'
            },
            {
                role: 'user',
                content: 'Connection test.'
            }
        ], { temperature: 0, maxTokens: 10, maxRetries: 2 }, cancellationToken);
        if (!result.toUpperCase().includes('OK')) {
            throw new Error(`Azure OpenAI connection test returned an unexpected response: ${result}`);
        }
    }
}
exports.AzureOpenAIClient = AzureOpenAIClient;
//# sourceMappingURL=azureOpenAIClient.js.map