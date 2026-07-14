"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWithTimeout = fetchWithTimeout;
exports.readErrorResponse = readErrorResponse;
async function fetchWithTimeout(url, init, timeoutMs, cancellationToken) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cancellation = cancellationToken?.onCancellationRequested(() => controller.abort());
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal
        });
    }
    catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`Request cancelled or timed out after ${timeoutMs} ms.`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
        cancellation?.dispose();
    }
}
async function readErrorResponse(response) {
    const text = await response.text();
    if (!text) {
        return `${response.status} ${response.statusText}`;
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed.detail === 'string') {
            return parsed.detail;
        }
        if (parsed.error?.message) {
            return parsed.error.message;
        }
    }
    catch {
        // Keep the original response text.
    }
    return text.slice(0, 2000);
}
//# sourceMappingURL=http.js.map