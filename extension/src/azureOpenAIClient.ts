import * as vscode from 'vscode';
import { getSettings } from './configuration';
import { fetchWithTimeout, readErrorResponse } from './http';
import { SecretStore } from './secretStore';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface CompletionOptions {
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
}

interface AzureChatResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
}

function parseDelayMilliseconds(response: Response, attempt: number): number {
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

async function delay(
    milliseconds: number,
    cancellationToken?: vscode.CancellationToken
): Promise<void> {
    if (cancellationToken?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }

    await new Promise<void>((resolve, reject) => {
        let subscription: vscode.Disposable | undefined;
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

export class AzureOpenAIClient {
    public constructor(private readonly secretStore: SecretStore) {}

    public async complete(
        messages: ChatMessage[],
        options: CompletionOptions = {},
        cancellationToken?: vscode.CancellationToken
    ): Promise<string> {
        const settings = getSettings();
        const apiKey = await this.secretStore.requireAzureApiKey();
        const url =
            `${settings.azure.endpoint}/openai/deployments/` +
            `${encodeURIComponent(settings.azure.deployment)}/chat/completions` +
            `?api-version=${encodeURIComponent(settings.azure.apiVersion)}`;
        const maxRetries = Math.max(0, options.maxRetries ?? 4);

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            const response = await fetchWithTimeout(
                url,
                {
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
                },
                settings.azure.timeoutMs,
                cancellationToken
            );

            if (response.ok) {
                const payload = (await response.json()) as AzureChatResponse;
                const content = payload.choices?.[0]?.message?.content?.trim();
                if (!content) {
                    throw new Error('Azure OpenAI returned an empty response.');
                }
                return content;
            }

            const errorText = await readErrorResponse(response);
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

    public async completeJson<T>(
        messages: ChatMessage[],
        cancellationToken?: vscode.CancellationToken,
        maxTokens = 900
    ): Promise<T> {
        const content = await this.complete(
            messages,
            { temperature: 0.05, maxTokens },
            cancellationToken
        );
        const cleaned = content
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        try {
            return JSON.parse(cleaned) as T;
        } catch {
            throw new Error(
                `Azure OpenAI did not return valid JSON. Response: ${cleaned.slice(0, 1200)}`
            );
        }
    }

    public async test(cancellationToken?: vscode.CancellationToken): Promise<void> {
        const result = await this.complete(
            [
                {
                    role: 'system',
                    content: 'Return only the word OK.'
                },
                {
                    role: 'user',
                    content: 'Connection test.'
                }
            ],
            { temperature: 0, maxTokens: 10, maxRetries: 2 },
            cancellationToken
        );
        if (!result.toUpperCase().includes('OK')) {
            throw new Error(`Azure OpenAI connection test returned an unexpected response: ${result}`);
        }
    }
}
