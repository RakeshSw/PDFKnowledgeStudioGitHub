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
exports.DocumentBuilderPanel = void 0;
const vscode = __importStar(require("vscode"));
const configuration_1 = require("./configuration");
const STATE_KEY = 'pdfKnowledge.documentBuilder.state';
class DocumentBuilderPanel {
    panel;
    context;
    documentService;
    static currentPanel;
    static createOrShow(context, documentService, seedPrompt = '') {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        if (DocumentBuilderPanel.currentPanel) {
            DocumentBuilderPanel.currentPanel.panel.reveal(column);
            DocumentBuilderPanel.currentPanel.post({ type: 'seedPrompt', prompt: seedPrompt });
            return;
        }
        const panel = vscode.window.createWebviewPanel('pdfKnowledge.documentBuilder', 'PDF Document Builder', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, 'media')
            ]
        });
        DocumentBuilderPanel.currentPanel = new DocumentBuilderPanel(panel, context, documentService, seedPrompt);
    }
    state;
    disposed = false;
    constructor(panel, context, documentService, seedPrompt) {
        this.panel = panel;
        this.context = context;
        this.documentService = documentService;
        this.state = context.workspaceState.get(STATE_KEY);
        panel.webview.html = this.html(panel.webview, seedPrompt);
        panel.onDidDispose(() => {
            this.disposed = true;
            DocumentBuilderPanel.currentPanel = undefined;
        });
        panel.webview.onDidReceiveMessage(message => void this.handleMessage(message));
        setTimeout(() => {
            this.post({ type: 'state', state: this.state, seedPrompt });
        }, 50);
    }
    post(message) {
        if (!this.disposed) {
            void this.panel.webview.postMessage(message);
        }
    }
    async persistAndPost() {
        await this.context.workspaceState.update(STATE_KEY, this.state);
        this.post({ type: 'state', state: this.state });
    }
    async handleMessage(message) {
        try {
            switch (message.type) {
                case 'ready':
                    this.post({ type: 'state', state: this.state });
                    break;
                case 'generate': {
                    const prompt = String(message.prompt ?? '').trim();
                    if (!prompt) {
                        throw new Error('Enter a document request.');
                    }
                    const mode = (message.mode === 'fast' ? 'fast' : 'deep');
                    this.post({ type: 'busy', busy: true, status: 'Starting document generation...' });
                    this.state = await this.documentService.generate(prompt, String(message.audience ?? ''), String(message.documentType ?? ''), mode, status => this.post({ type: 'progress', status }));
                    await this.persistAndPost();
                    break;
                }
                case 'addSection': {
                    if (!this.state) {
                        throw new Error('Generate a document before adding a section.');
                    }
                    const request = String(message.request ?? '').trim();
                    if (!request) {
                        throw new Error('Enter the section you want to add.');
                    }
                    const editedMarkdown = String(message.markdown ?? this.state.markdown);
                    this.state = this.documentService.rebuildFromEditedMarkdown(this.state, editedMarkdown);
                    const mode = (message.mode === 'fast' ? 'fast' : 'deep');
                    this.post({ type: 'busy', busy: true, status: 'Adding the requested section...' });
                    this.state = await this.documentService.addSection(this.state, request, mode, status => this.post({ type: 'progress', status }));
                    await this.persistAndPost();
                    break;
                }
                case 'generateDiagram': {
                    if (!this.state) {
                        throw new Error('Generate a document before creating a visual explanation.');
                    }
                    const editedMarkdown = String(message.markdown ?? this.state.markdown);
                    this.state = this.documentService.rebuildFromEditedMarkdown(this.state, editedMarkdown);
                    const mode = (message.mode === 'fast' ? 'fast' : 'deep');
                    this.post({ type: 'busy', busy: true, status: 'Creating the visual explanation...' });
                    this.state = await this.documentService.addDiagram(this.state, String(message.request ?? ''), mode, status => this.post({ type: 'progress', status }));
                    await this.persistAndPost();
                    break;
                }
                case 'save': {
                    if (!this.state) {
                        throw new Error('There is no generated document to save.');
                    }
                    const markdown = String(message.markdown ?? this.state.markdown);
                    this.state = this.documentService.rebuildFromEditedMarkdown(this.state, markdown);
                    await this.saveMarkdown(this.state);
                    await this.context.workspaceState.update(STATE_KEY, this.state);
                    break;
                }
                case 'clear':
                    this.state = undefined;
                    await this.persistAndPost();
                    break;
            }
        }
        catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            this.post({ type: 'error', message: messageText });
        }
        finally {
            this.post({ type: 'busy', busy: false, status: '' });
        }
    }
    async saveMarkdown(state) {
        const settings = (0, configuration_1.getSettings)();
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const fileName = `${state.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document'}.md`;
        const defaultUri = workspaceFolder
            ? vscode.Uri.joinPath(workspaceFolder, settings.document.outputFolder, fileName)
            : vscode.Uri.file(fileName);
        const uri = await vscode.window.showSaveDialog({
            defaultUri,
            filters: { Markdown: ['md'] },
            saveLabel: 'Save Document'
        });
        if (!uri) {
            return;
        }
        const parent = vscode.Uri.joinPath(uri, '..');
        try {
            await vscode.workspace.fs.createDirectory(parent);
        }
        catch {
            // The parent may already exist or may be managed by the save provider.
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(state.markdown, 'utf8'));
        await vscode.window.showTextDocument(uri, { preview: false });
        void vscode.window.showInformationMessage(`Document saved: ${uri.fsPath || uri.toString()}`);
    }
    html(webview, seedPrompt) {
        const nonce = Math.random().toString(36).slice(2);
        const escapedSeed = seedPrompt
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
        const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'marked.min.js'));
        const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mermaid.min.js'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<title>PDF Document Builder</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
.app { display: grid; grid-template-columns: minmax(310px, 34%) 1fr; height: 100vh; }
.controls { padding: 18px; border-right: 1px solid var(--vscode-panel-border); overflow: auto; background: var(--vscode-sideBar-background); }
.viewer { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
h1 { font-size: 18px; margin: 0 0 6px; }
.subtle { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 18px; line-height: 1.5; }
.group { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--vscode-panel-border); }
.groupTitle { font-size: 13px; font-weight: 700; margin-bottom: 3px; }
label { display: block; margin: 12px 0 5px; font-weight: 600; font-size: 12px; }
textarea, input, select {
  width: 100%; border: 1px solid var(--vscode-input-border);
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  padding: 8px; font: inherit;
}
textarea { resize: vertical; min-height: 88px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
button {
  border: 0; padding: 8px 11px; cursor: pointer; border-radius: 2px;
  color: var(--vscode-button-foreground); background: var(--vscode-button-background);
}
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .55; cursor: default; }
.status { min-height: 20px; margin-top: 12px; color: var(--vscode-descriptionForeground); font-size: 12px; }
.error { color: var(--vscode-errorForeground); white-space: pre-wrap; font-size: 12px; }
.viewerHeader { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editorGroupHeader-tabsBackground); }
.viewerTitle { display: flex; align-items: center; gap: 8px; min-width: 0; }
.viewTabs { display: flex; gap: 2px; background: var(--vscode-editorGroupHeader-tabsBackground); }
.viewTab { color: var(--vscode-foreground); background: transparent; border: 1px solid transparent; padding: 6px 10px; }
.viewTab.active { background: var(--vscode-tab-activeBackground); border-color: var(--vscode-panel-border); }
.badge { font-size: 11px; padding: 3px 7px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
.viewBody { position: relative; flex: 1; min-height: 0; overflow: hidden; }
#documentMarkdown { width: 100%; height: 100%; min-height: 0; resize: none; border: 0; padding: 20px; outline: none; line-height: 1.5; font-family: var(--vscode-editor-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
#documentPreview { height: 100%; overflow: auto; padding: 26px clamp(20px, 4vw, 60px) 60px; background: var(--vscode-editor-background); }
#documentPreview .documentPage { max-width: 980px; margin: 0 auto; }
#documentPreview h1 { font-size: 30px; margin: 0 0 24px; line-height: 1.25; }
#documentPreview h2 { font-size: 22px; margin: 34px 0 14px; padding-bottom: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
#documentPreview h3 { font-size: 17px; margin: 26px 0 10px; }
#documentPreview p, #documentPreview li { line-height: 1.65; }
#documentPreview table { width: 100%; border-collapse: collapse; margin: 14px 0 20px; }
#documentPreview th, #documentPreview td { border: 1px solid var(--vscode-panel-border); padding: 8px 10px; text-align: left; vertical-align: top; }
#documentPreview th { background: var(--vscode-editorWidget-background); }
#documentPreview blockquote { margin: 16px 0; padding: 8px 16px; border-left: 4px solid var(--vscode-textBlockQuote-border); background: var(--vscode-textBlockQuote-background); }
#documentPreview pre { overflow: auto; padding: 14px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
#documentPreview code { font-family: var(--vscode-editor-font-family); }
#documentPreview a { color: var(--vscode-textLink-foreground); }
#documentPreview .mermaidHost { margin: 18px 0 24px; padding: 16px; overflow: auto; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editorWidget-background); text-align: center; }
#documentPreview .mermaidHost svg { max-width: 100%; height: auto; }
#documentPreview .diagramError { color: var(--vscode-errorForeground); text-align: left; white-space: pre-wrap; }
.emptyPreview { min-height: 55vh; display: grid; place-items: center; color: var(--vscode-descriptionForeground); text-align: center; }
.hidden { display: none !important; }
@media (max-width: 900px) {
  .app { grid-template-columns: 1fr; height: auto; min-height: 100vh; }
  .controls { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .viewer { min-height: 70vh; }
  .viewBody { min-height: 64vh; }
}
</style>
</head>
<body>
<div class="app">
  <section class="controls">
    <h1>PDF Document Builder</h1>
    <div class="subtle">Azure planning → Retrieval V4 evidence → grounded writing → rendered preview</div>

    <label for="prompt">Document request</label>
    <textarea id="prompt" placeholder="Example: Create an implementation guide for NIST CSF Organizational Profiles">${escapedSeed}</textarea>

    <div class="row">
      <div>
        <label for="audience">Audience</label>
        <input id="audience" value="Security and risk management teams">
      </div>
      <div>
        <label for="documentType">Document type</label>
        <select id="documentType">
          <option value="guide">Guide</option>
          <option value="report">Report</option>
          <option value="implementation plan">Implementation Plan</option>
          <option value="technical note">Technical Note</option>
          <option value="policy">Policy</option>
          <option value="overview">Overview</option>
        </select>
      </div>
    </div>

    <label for="mode">Retrieval mode</label>
    <select id="mode"><option value="deep">Deep</option><option value="fast">Fast</option></select>

    <div class="actions">
      <button id="generate">Generate Document</button>
      <button id="save" class="secondary">Save Markdown</button>
      <button id="clear" class="secondary">Clear</button>
    </div>

    <div class="group">
      <div class="groupTitle">Add a grounded section</div>
      <div class="subtle">The new section will retrieve its own evidence and be appended to the document.</div>
      <textarea id="sectionRequest" placeholder="Example: Add a section comparing Current and Target Profiles"></textarea>
      <div class="actions">
        <button id="addSection">Add Section</button>
      </div>
    </div>

    <div class="group">
      <div class="groupTitle">Generate a visual explanation</div>
      <div class="subtle">Creates an evidence-grounded Mermaid diagram and renders it in Preview. Leave the request blank to visualize the document's main process or relationships.</div>
      <textarea id="diagramRequest" placeholder="Example: Visualize the five-step Organizational Profile process"></textarea>
      <div class="actions">
        <button id="generateDiagram">Generate Mermaid Diagram</button>
      </div>
    </div>

    <div id="status" class="status"></div>
    <div id="error" class="error"></div>
  </section>

  <section class="viewer">
    <div class="viewerHeader">
      <div class="viewerTitle">
        <strong>Document</strong>
        <span id="badge" class="badge">No document</span>
      </div>
      <div class="viewTabs" role="tablist" aria-label="Document view">
        <button id="showPreview" class="viewTab active" type="button">Preview</button>
        <button id="showMarkdown" class="viewTab" type="button">Markdown</button>
      </div>
    </div>
    <div class="viewBody">
      <div id="documentPreview"><div class="emptyPreview">Generate a document to see the rendered preview.</div></div>
      <textarea id="documentMarkdown" class="hidden" spellcheck="false" placeholder="The generated Markdown will appear here."></textarea>
    </div>
  </section>
</div>
<script nonce="${nonce}" src="${markedUri}"></script>
<script nonce="${nonce}" src="${mermaidUri}"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const elements = {
  prompt: document.getElementById('prompt'),
  audience: document.getElementById('audience'),
  documentType: document.getElementById('documentType'),
  mode: document.getElementById('mode'),
  sectionRequest: document.getElementById('sectionRequest'),
  diagramRequest: document.getElementById('diagramRequest'),
  markdown: document.getElementById('documentMarkdown'),
  preview: document.getElementById('documentPreview'),
  status: document.getElementById('status'),
  error: document.getElementById('error'),
  badge: document.getElementById('badge'),
  generate: document.getElementById('generate'),
  addSection: document.getElementById('addSection'),
  generateDiagram: document.getElementById('generateDiagram'),
  save: document.getElementById('save'),
  clear: document.getElementById('clear'),
  showPreview: document.getElementById('showPreview'),
  showMarkdown: document.getElementById('showMarkdown')
};

let activeView = 'preview';
let renderTimer;

function setBusy(busy, status) {
  [elements.generate, elements.addSection, elements.generateDiagram, elements.save, elements.clear]
    .forEach(button => button.disabled = busy);
  elements.status.textContent = status || '';
  if (busy) elements.error.textContent = '';
}

function setView(view) {
  activeView = view === 'markdown' ? 'markdown' : 'preview';
  const previewActive = activeView === 'preview';
  elements.preview.classList.toggle('hidden', !previewActive);
  elements.markdown.classList.toggle('hidden', previewActive);
  elements.showPreview.classList.toggle('active', previewActive);
  elements.showMarkdown.classList.toggle('active', !previewActive);
  if (previewActive) renderPreview();
}

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, iframe, object, embed, link, meta, base, form, input, button, textarea, select')
    .forEach(node => node.remove());
  template.content.querySelectorAll('*').forEach(node => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'style' || (name === 'href' && value.startsWith('javascript:'))) {
        node.removeAttribute(attribute.name);
      }
    }
    if (node.tagName === 'A') {
      node.setAttribute('rel', 'noreferrer noopener');
    }
  });
  return template.innerHTML;
}

async function renderMermaidBlocks() {
  if (!window.mermaid) return;
  const codeBlocks = Array.from(elements.preview.querySelectorAll('pre code.language-mermaid'));
  if (!codeBlocks.length) return;

  const theme = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')
    ? 'dark'
    : 'default';
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true }
  });

  for (let index = 0; index < codeBlocks.length; index += 1) {
    const code = codeBlocks[index];
    const pre = code.parentElement;
    if (!pre) continue;
    const host = document.createElement('div');
    host.className = 'mermaidHost';
    pre.replaceWith(host);
    try {
      const id = 'pdf-knowledge-mermaid-' + Date.now() + '-' + index;
      const result = await window.mermaid.render(id, code.textContent || '');
      host.innerHTML = result.svg;
    } catch (error) {
      host.innerHTML = '';
      const message = document.createElement('div');
      message.className = 'diagramError';
      message.textContent = 'Mermaid preview error: ' + (error && error.message ? error.message : String(error));
      host.appendChild(message);
      const source = document.createElement('pre');
      source.textContent = code.textContent || '';
      host.appendChild(source);
    }
  }
}

async function renderPreview() {
  const markdown = elements.markdown.value || '';
  if (!markdown.trim()) {
    elements.preview.innerHTML = '<div class="emptyPreview">Generate a document to see the rendered preview.</div>';
    return;
  }
  try {
    const rendered = window.marked && window.marked.parse
      ? window.marked.parse(markdown, { gfm: true, breaks: false })
      : '<pre>' + markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
    elements.preview.innerHTML = '<article class="documentPage">' + sanitizeHtml(rendered) + '</article>';
    await renderMermaidBlocks();
  } catch (error) {
    elements.preview.innerHTML = '<div class="emptyPreview">Preview could not be rendered.</div>';
    elements.error.textContent = error && error.message ? error.message : String(error);
  }
}

function schedulePreview() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (activeView === 'preview') renderPreview();
  }, 250);
}

elements.showPreview.addEventListener('click', () => setView('preview'));
elements.showMarkdown.addEventListener('click', () => setView('markdown'));
elements.markdown.addEventListener('input', schedulePreview);

elements.generate.addEventListener('click', () => vscode.postMessage({
  type: 'generate',
  prompt: elements.prompt.value,
  audience: elements.audience.value,
  documentType: elements.documentType.value,
  mode: elements.mode.value
}));
elements.addSection.addEventListener('click', () => vscode.postMessage({
  type: 'addSection',
  request: elements.sectionRequest.value,
  markdown: elements.markdown.value,
  mode: elements.mode.value
}));
elements.generateDiagram.addEventListener('click', () => vscode.postMessage({
  type: 'generateDiagram',
  request: elements.diagramRequest.value,
  markdown: elements.markdown.value,
  mode: elements.mode.value
}));
elements.save.addEventListener('click', () => vscode.postMessage({
  type: 'save',
  markdown: elements.markdown.value
}));
elements.clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'busy') setBusy(message.busy, message.status);
  if (message.type === 'progress') elements.status.textContent = message.status || '';
  if (message.type === 'error') elements.error.textContent = message.message || 'Unknown error';
  if (message.type === 'seedPrompt' && message.prompt) elements.prompt.value = message.prompt;
  if (message.type === 'state') {
    const state = message.state;
    if (message.seedPrompt) elements.prompt.value = message.seedPrompt;
    elements.markdown.value = state && state.markdown ? state.markdown : '';
    elements.badge.textContent = state
      ? state.sections.length + ' sections · ' + state.language
      : 'No document';
    if (state) {
      elements.audience.value = state.audience || elements.audience.value;
      elements.documentType.value = state.documentType || elements.documentType.value;
    }
    elements.error.textContent = '';
    setView('preview');
  }
});

setView('preview');
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
exports.DocumentBuilderPanel = DocumentBuilderPanel;
//# sourceMappingURL=documentBuilderPanel.js.map