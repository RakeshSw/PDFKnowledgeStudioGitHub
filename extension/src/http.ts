import * as vscode from 'vscode';

export async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    cancellationToken?: vscode.CancellationToken
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cancellation = cancellationToken?.onCancellationRequested(() => controller.abort());

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal
        });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`Request cancelled or timed out after ${timeoutMs} ms.`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        cancellation?.dispose();
    }
}

export async function readErrorResponse(response: Response): Promise<string> {
    const text = await response.text();
    if (!text) {
        return `${response.status} ${response.statusText}`;
    }
    try {
        const parsed = JSON.parse(text) as { detail?: unknown; error?: { message?: string } };
        if (typeof parsed.detail === 'string') {
            return parsed.detail;
        }
        if (parsed.error?.message) {
            return parsed.error.message;
        }
    } catch {
        // Keep the original response text.
    }
    return text.slice(0, 2000);
}
