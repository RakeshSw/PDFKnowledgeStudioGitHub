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
exports.getSettings = getSettings;
const vscode = __importStar(require("vscode"));
function requiredString(config, key) {
    const value = (config.get(key) ?? '').trim();
    if (!value) {
        throw new Error(`Missing VS Code setting: pdfKnowledge.${key}`);
    }
    return value;
}
function getSettings() {
    const config = vscode.workspace.getConfiguration('pdfKnowledge');
    return {
        azure: {
            endpoint: requiredString(config, 'azure.endpoint').replace(/\/+$/, ''),
            deployment: requiredString(config, 'azure.deployment'),
            apiVersion: requiredString(config, 'azure.apiVersion'),
            temperature: config.get('azure.temperature', 0.1),
            maxTokens: config.get('azure.maxTokens', 1600),
            timeoutMs: config.get('azure.timeoutMs', 120000)
        },
        retrieval: {
            defaultMode: config.get('retrieval.defaultMode', 'deep'),
            maxCompoundQueries: config.get('retrieval.maxCompoundQueries', 4)
        },
        document: {
            maxSections: config.get('document.maxSections', 6),
            outputFolder: config.get('document.outputFolder', 'generated-documents')
        },
        logging: {
            showPlan: config.get('logging.showPlan', false)
        }
    };
}
//# sourceMappingURL=configuration.js.map