import * as vscode from 'vscode';
import { RetrievalMode } from './types';

export interface ExtensionSettings {
    azure: {
        endpoint: string;
        deployment: string;
        apiVersion: string;
        temperature: number;
        maxTokens: number;
        timeoutMs: number;
    };
    retrieval: {
        defaultMode: RetrievalMode;
        maxCompoundQueries: number;
    };
    document: {
        maxSections: number;
        outputFolder: string;
    };
    logging: {
        showPlan: boolean;
    };
}

function requiredString(config: vscode.WorkspaceConfiguration, key: string): string {
    const value = (config.get<string>(key) ?? '').trim();
    if (!value) {
        throw new Error(`Missing VS Code setting: pdfKnowledge.${key}`);
    }
    return value;
}

export function getSettings(): ExtensionSettings {
    const config = vscode.workspace.getConfiguration('pdfKnowledge');
    return {
        azure: {
            endpoint: requiredString(config, 'azure.endpoint').replace(/\/+$/, ''),
            deployment: requiredString(config, 'azure.deployment'),
            apiVersion: requiredString(config, 'azure.apiVersion'),
            temperature: config.get<number>('azure.temperature', 0.1),
            maxTokens: config.get<number>('azure.maxTokens', 1600),
            timeoutMs: config.get<number>('azure.timeoutMs', 120000)
        },
        retrieval: {
            defaultMode: config.get<RetrievalMode>('retrieval.defaultMode', 'deep'),
            maxCompoundQueries: config.get<number>('retrieval.maxCompoundQueries', 4)
        },
        document: {
            maxSections: config.get<number>('document.maxSections', 6),
            outputFolder: config.get<string>('document.outputFolder', 'generated-documents')
        },
        logging: {
            showPlan: config.get<boolean>('logging.showPlan', false)
        }
    };
}
