import * as vscode from 'vscode';
import { KnowledgeExplorerService } from './knowledgeExplorerService';
import {
    KnowledgeExplorerState,
    KnowledgeMap,
    KnowledgeNodeDetail,
    RetrievalMode
} from './types';

const STATE_KEY = 'pdfKnowledge.knowledgeExplorer.state';
const DEFAULT_TOPIC =
    'Show me the overall knowledge map and the major concepts I should learn first.';

export class KnowledgeExplorerPanel {
    private static currentPanel: KnowledgeExplorerPanel | undefined;

    public static createOrShow(
        context: vscode.ExtensionContext,
        service: KnowledgeExplorerService,
        seedTopic = ''
    ): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (KnowledgeExplorerPanel.currentPanel) {
            KnowledgeExplorerPanel.currentPanel.panel.reveal(column);
            if (seedTopic.trim()) {
                KnowledgeExplorerPanel.currentPanel.post({
                    type: 'seedTopic',
                    topic: seedTopic
                });
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'pdfKnowledge.knowledgeExplorer',
            'PDF Knowledge Explorer',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media')
                ]
            }
        );

        KnowledgeExplorerPanel.currentPanel = new KnowledgeExplorerPanel(
            panel,
            context,
            service,
            seedTopic
        );
    }

    private state: KnowledgeExplorerState;
    private disposed = false;
    private autoMapStarted = false;

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext,
        private readonly service: KnowledgeExplorerService,
        private readonly seedTopic: string
    ) {
        this.state =
            context.workspaceState.get<KnowledgeExplorerState>(STATE_KEY) ??
            service.initialState();

        panel.webview.html = this.html(panel.webview);
        panel.onDidDispose(() => {
            this.disposed = true;
            KnowledgeExplorerPanel.currentPanel = undefined;
        });
        panel.webview.onDidReceiveMessage(message => void this.handleMessage(message));
    }

    private post(message: unknown): void {
        if (!this.disposed) {
            void this.panel.webview.postMessage(message);
        }
    }

    private async persist(): Promise<void> {
        this.state.updatedAt = new Date().toISOString();
        await this.context.workspaceState.update(STATE_KEY, this.state);
    }

    private mode(value: unknown): RetrievalMode {
        return value === 'fast' ? 'fast' : 'deep';
    }

    private async generateMap(
        topic: string,
        level: string,
        mode: RetrievalMode
    ): Promise<void> {
        this.post({
            type: 'busy',
            busy: true,
            status: 'Starting Knowledge Explorer...'
        });

        const map = await this.service.createMap(
            topic,
            level,
            mode,
            status => this.post({ type: 'progress', status })
        );

        this.state = {
            map,
            selectedNodeId: undefined,
            detail: undefined,
            learningLevel: level,
            retrievalMode: mode,
            updatedAt: new Date().toISOString()
        };

        await this.persist();
        this.post({ type: 'state', state: this.state });
    }

    private async exploreNode(nodeId: string): Promise<void> {
        if (!this.state.map) {
            throw new Error('Generate a knowledge map before exploring a concept.');
        }

        this.post({
            type: 'busy',
            busy: true,
            status: 'Opening the guided learning card...'
        });

        const detail = await this.service.exploreNode(
            this.state.map,
            nodeId,
            this.state.learningLevel,
            this.state.retrievalMode,
            status => this.post({ type: 'progress', status })
        );

        this.state = {
            ...this.state,
            selectedNodeId: nodeId,
            detail,
            updatedAt: new Date().toISOString()
        };

        await this.persist();
        this.post({ type: 'state', state: this.state });
    }

    private async exploreQuestion(question: string): Promise<void> {
        if (!this.state.map) {
            throw new Error('Generate a knowledge map before starting a deep dive.');
        }
        if (!question.trim()) {
            throw new Error('Enter or select a question to explore.');
        }

        this.post({
            type: 'busy',
            busy: true,
            status: 'Starting the evidence-grounded deep dive...'
        });

        const detail = await this.service.exploreQuestion(
            this.state.map,
            question.trim(),
            this.state.learningLevel,
            this.state.retrievalMode,
            status => this.post({ type: 'progress', status })
        );

        this.state = {
            ...this.state,
            selectedNodeId: detail.nodeId,
            detail,
            updatedAt: new Date().toISOString()
        };

        await this.persist();
        this.post({ type: 'state', state: this.state });
    }

    private async handleMessage(message: Record<string, unknown>): Promise<void> {
        try {
            switch (message.type) {
                case 'ready': {
                    this.post({
                        type: 'state',
                        state: this.state,
                        seedTopic: this.seedTopic
                    });

                    if (!this.state.map && !this.autoMapStarted) {
                        this.autoMapStarted = true;
                        await this.generateMap(
                            this.seedTopic.trim() || DEFAULT_TOPIC,
                            this.state.learningLevel,
                            this.state.retrievalMode
                        );
                    }
                    break;
                }

                case 'generateMap':
                    await this.generateMap(
                        String(message.topic ?? DEFAULT_TOPIC),
                        String(message.learningLevel ?? 'New to the topic'),
                        this.mode(message.mode)
                    );
                    break;

                case 'exploreNode':
                    await this.exploreNode(String(message.nodeId ?? ''));
                    break;

                case 'exploreQuestion':
                    await this.exploreQuestion(String(message.question ?? ''));
                    break;

                case 'createDocument': {
                    const prompt = String(message.prompt ?? '').trim();
                    if (!prompt) {
                        throw new Error('No concept is selected for document generation.');
                    }
                    await vscode.commands.executeCommand(
                        'pdfKnowledge.openDocumentBuilder',
                        prompt
                    );
                    break;
                }

                case 'askChat': {
                    const query = String(message.query ?? '').trim();
                    if (!query) {
                        throw new Error('No question is available for chat.');
                    }
                    await vscode.commands.executeCommand(
                        'workbench.action.chat.open',
                        { query: `@pdf-knowledge ${query}` }
                    );
                    break;
                }

                case 'clear':
                    this.state = this.service.initialState();
                    this.autoMapStarted = true;
                    await this.persist();
                    this.post({ type: 'state', state: this.state });
                    break;
            }
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            this.post({ type: 'error', message: messageText });
        } finally {
            this.post({ type: 'busy', busy: false, status: '' });
        }
    }

    private html(webview: vscode.Webview): string {
        const nonce = Math.random().toString(36).slice(2);
        const mermaidUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mermaid.min.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<title>PDF Knowledge Explorer</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
button, input, select, textarea { font: inherit; }
button {
  border: 0;
  padding: 8px 11px;
  cursor: pointer;
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
  border-radius: 3px;
}
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button.ghost {
  color: var(--vscode-foreground);
  background: transparent;
  border: 1px solid var(--vscode-panel-border);
}
button:disabled { opacity: .55; cursor: default; }
input, select, textarea {
  width: 100%;
  border: 1px solid var(--vscode-input-border);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 8px;
}
.app { min-height: 100vh; display: flex; flex-direction: column; }
.topbar {
  padding: 14px 18px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
}
.titleRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h1 { margin: 0; font-size: 20px; }
.subtitle { margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 12px; }
.controls {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 180px 110px auto auto;
  gap: 8px;
  align-items: end;
  margin-top: 14px;
}
.field label {
  display: block;
  margin-bottom: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
}
.statusRow {
  min-height: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 8px;
  font-size: 12px;
}
#status { color: var(--vscode-descriptionForeground); }
#error { color: var(--vscode-errorForeground); }
.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(440px, 1fr) minmax(340px, 430px);
}
.sidebar, .detail {
  overflow: auto;
  background: var(--vscode-sideBar-background);
}
.sidebar { border-right: 1px solid var(--vscode-panel-border); padding: 14px; }
.detail { border-left: 1px solid var(--vscode-panel-border); padding: 18px; }
.mapPane { min-width: 0; overflow: auto; padding: 18px; }
.sectionTitle {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 10px;
}
.progressCard {
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-editorWidget-background);
  margin-bottom: 14px;
}
.progressTrack {
  height: 6px;
  border-radius: 4px;
  background: var(--vscode-progressBar-background);
  opacity: .3;
  overflow: hidden;
  margin: 8px 0;
}
.progressFill {
  height: 100%;
  background: var(--vscode-progressBar-background);
  opacity: 1;
  width: 0;
}
.pathList { display: grid; gap: 6px; }
.pathItem {
  width: 100%;
  text-align: left;
  color: var(--vscode-foreground);
  background: transparent;
  border: 1px solid transparent;
  padding: 8px;
}
.pathItem:hover { border-color: var(--vscode-panel-border); background: var(--vscode-list-hoverBackground); }
.pathItem.active {
  border-color: var(--vscode-focusBorder);
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}
.pathNumber {
  display: inline-grid;
  width: 21px;
  height: 21px;
  place-items: center;
  border-radius: 50%;
  margin-right: 7px;
  border: 1px solid currentColor;
  font-size: 10px;
}
.mapHeader h2 { margin: 0; font-size: 24px; }
.mapOverview { color: var(--vscode-descriptionForeground); line-height: 1.55; margin: 8px 0 16px; }
.mapMeta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.badge {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 12px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}
.mapHost {
  min-height: 360px;
  display: grid;
  place-items: center;
  padding: 18px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-editorWidget-background);
  overflow: auto;
}
.mapHost svg { max-width: 100%; height: auto; }
.mapError { color: var(--vscode-errorForeground); white-space: pre-wrap; }
.nodeGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.nodeCard {
  color: var(--vscode-foreground);
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 7px;
  padding: 12px;
  text-align: left;
  min-height: 128px;
}
.nodeCard:hover { border-color: var(--vscode-focusBorder); transform: translateY(-1px); }
.nodeCard.active { border: 2px solid var(--vscode-focusBorder); }
.nodeCategory {
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .05em;
}
.nodeLabel { display: block; font-weight: 700; margin: 6px 0; }
.nodeSummary { display: block; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; }
.detailEmpty {
  min-height: 70vh;
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  padding: 24px;
}
.detail h2 { margin: 4px 0 6px; font-size: 23px; }
.detail h3 {
  font-size: 14px;
  margin: 22px 0 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.detail p, .detail li { line-height: 1.55; }
.detail ul, .detail ol { padding-left: 22px; }
.actionRow { display: flex; flex-wrap: wrap; gap: 7px; margin: 14px 0; }
.chipGrid { display: flex; flex-wrap: wrap; gap: 7px; }
.chip {
  color: var(--vscode-foreground);
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 15px;
  padding: 6px 9px;
  text-align: left;
  font-size: 11px;
}
.chip:hover { border-color: var(--vscode-focusBorder); }
.relationship { display: block; opacity: .75; font-size: 10px; margin-top: 2px; }
.miniDiagram {
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-editorWidget-background);
  overflow: auto;
}
.miniDiagram svg { max-width: 100%; height: auto; }
.sourceList { display: grid; gap: 7px; }
.sourceItem {
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 5px;
  font-size: 11px;
}
.quizOption {
  width: 100%;
  display: block;
  text-align: left;
  margin: 6px 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-panel-border);
}
.quizOption.correct { border-color: var(--vscode-testing-iconPassed); }
.quizOption.incorrect { border-color: var(--vscode-testing-iconFailed); }
.quizFeedback {
  margin-top: 8px;
  padding: 9px;
  border-left: 3px solid var(--vscode-focusBorder);
  background: var(--vscode-editorWidget-background);
  line-height: 1.45;
}
.deepDive { margin-top: 18px; }
.deepDive textarea { min-height: 72px; resize: vertical; }
.emptyMap {
  min-height: 65vh;
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--vscode-descriptionForeground);
}
.hidden { display: none !important; }
@media (max-width: 1180px) {
  .workspace { grid-template-columns: 220px 1fr; }
  .detail { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--vscode-panel-border); }
}
@media (max-width: 760px) {
  .controls { grid-template-columns: 1fr 1fr; }
  .controls .topicField { grid-column: 1 / -1; }
  .workspace { grid-template-columns: 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="titleRow">
      <div>
        <h1>Knowledge Explorer</h1>
        <div class="subtitle">Evidence-grounded concept map · guided learning · visual deep dives</div>
      </div>
      <span id="versionBadge" class="badge">Waiting for map</span>
    </div>
    <div class="controls">
      <div class="field topicField">
        <label for="topic">What do you want to explore?</label>
        <input id="topic" value="${DEFAULT_TOPIC.replace(/"/g, '&quot;')}">
      </div>
      <div class="field">
        <label for="level">Learning level</label>
        <select id="level">
          <option>New to the topic</option>
          <option>Working knowledge</option>
          <option>Expert</option>
        </select>
      </div>
      <div class="field">
        <label for="mode">Mode</label>
        <select id="mode"><option value="deep">Deep</option><option value="fast">Fast</option></select>
      </div>
      <button id="generateMap">Generate Map</button>
      <button id="clear" class="secondary">Reset</button>
    </div>
    <div class="statusRow">
      <span id="status"></span>
      <span id="error"></span>
    </div>
  </header>

  <main class="workspace">
    <aside class="sidebar">
      <div class="sectionTitle">Guided learning path</div>
      <div id="progressCard" class="progressCard">
        <div id="progressText">Choose a node to begin.</div>
        <div class="progressTrack"><div id="progressFill" class="progressFill"></div></div>
        <div class="actionRow">
          <button id="previousNode" class="secondary">Previous</button>
          <button id="nextNode">Next</button>
        </div>
      </div>
      <div id="pathList" class="pathList"></div>
    </aside>

    <section class="mapPane">
      <div id="mapContent" class="emptyMap">
        Building the overall knowledge map...
      </div>
    </section>

    <aside id="detail" class="detail">
      <div class="detailEmpty">
        Select any concept in the map or learning path to start digging deeper.
      </div>
    </aside>
  </main>
</div>

<script nonce="${nonce}" src="${mermaidUri}"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const elements = {
  topic: document.getElementById('topic'),
  level: document.getElementById('level'),
  mode: document.getElementById('mode'),
  generateMap: document.getElementById('generateMap'),
  clear: document.getElementById('clear'),
  status: document.getElementById('status'),
  error: document.getElementById('error'),
  versionBadge: document.getElementById('versionBadge'),
  progressText: document.getElementById('progressText'),
  progressFill: document.getElementById('progressFill'),
  previousNode: document.getElementById('previousNode'),
  nextNode: document.getElementById('nextNode'),
  pathList: document.getElementById('pathList'),
  mapContent: document.getElementById('mapContent'),
  detail: document.getElementById('detail')
};

let explorerState;
let currentMap;
let currentDetail;
let busy = false;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setBusy(value, status) {
  busy = Boolean(value);
  [elements.generateMap, elements.clear, elements.previousNode, elements.nextNode]
    .forEach(button => button.disabled = busy);
  elements.status.textContent = status || '';
  if (busy) elements.error.textContent = '';
}

function sourcePages(source) {
  return source.page_start === source.page_end
    ? 'p. ' + source.page_start
    : 'pp. ' + source.page_start + '-' + source.page_end;
}

function selectedIndex() {
  if (!currentMap || !explorerState || !explorerState.selectedNodeId) return -1;
  return currentMap.guidedOrder.indexOf(explorerState.selectedNodeId);
}

function updateProgress() {
  if (!currentMap || !currentMap.guidedOrder.length) {
    elements.progressText.textContent = 'Choose a node to begin.';
    elements.progressFill.style.width = '0%';
    elements.previousNode.disabled = true;
    elements.nextNode.disabled = true;
    return;
  }

  const index = selectedIndex();
  if (index < 0) {
    elements.progressText.textContent =
      currentMap.guidedOrder.length + ' concepts · select the first lesson to begin';
    elements.progressFill.style.width = '0%';
    elements.previousNode.disabled = true;
    elements.nextNode.disabled = busy;
    elements.nextNode.textContent = 'Start';
    return;
  }

  const node = currentMap.nodes.find(item => item.id === currentMap.guidedOrder[index]);
  elements.progressText.textContent =
    'Lesson ' + (index + 1) + ' of ' + currentMap.guidedOrder.length +
    (node ? ' · ' + node.label : '');
  elements.progressFill.style.width =
    Math.round(((index + 1) / currentMap.guidedOrder.length) * 100) + '%';
  elements.previousNode.disabled = busy || index <= 0;
  elements.nextNode.disabled = busy || index >= currentMap.guidedOrder.length - 1;
  elements.nextNode.textContent = 'Next';
}

function exploreNode(nodeId) {
  if (!nodeId || busy) return;
  vscode.postMessage({ type: 'exploreNode', nodeId });
}

window.exploreKnowledgeNode = function(nodeId) {
  exploreNode(String(nodeId || ''));
};

function renderPath() {
  if (!currentMap) {
    elements.pathList.innerHTML = '';
    updateProgress();
    return;
  }

  elements.pathList.innerHTML = currentMap.guidedOrder.map((id, index) => {
    const node = currentMap.nodes.find(item => item.id === id);
    if (!node) return '';
    const active = explorerState && explorerState.selectedNodeId === id ? ' active' : '';
    return '<button class="pathItem' + active + '" data-node-id="' + escapeHtml(id) + '">' +
      '<span class="pathNumber">' + (index + 1) + '</span>' +
      escapeHtml(node.label) +
      '</button>';
  }).join('');

  elements.pathList.querySelectorAll('[data-node-id]').forEach(button => {
    button.addEventListener('click', () => exploreNode(button.dataset.nodeId));
  });
  updateProgress();
}

async function renderMapDiagram(map) {
  const host = document.getElementById('knowledgeMapHost');
  if (!host || !window.mermaid) return;

  const theme =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
      ? 'dark'
      : 'default';

  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme,
    flowchart: { htmlLabels: false, useMaxWidth: true }
  });

  try {
    const result = await window.mermaid.render(
      'knowledge-explorer-map-' + Date.now(),
      map.mermaid
    );
    host.innerHTML = result.svg;
    if (result.bindFunctions) {
      result.bindFunctions(host);
    }
  } catch (error) {
    host.innerHTML =
      '<div class="mapError">Map rendering error: ' +
      escapeHtml(error && error.message ? error.message : String(error)) +
      '</div><pre>' + escapeHtml(map.mermaid) + '</pre>';
  }
}

function renderMap(map) {
  currentMap = map;
  elements.versionBadge.textContent =
    map.nodes.length + ' concepts · ' + map.learningLevel;

  const cards = map.nodes.map(node => {
    const active = explorerState && explorerState.selectedNodeId === node.id ? ' active' : '';
    return '<button class="nodeCard' + active + '" data-node-id="' + escapeHtml(node.id) + '">' +
      '<span class="nodeCategory">' + escapeHtml(node.category) + '</span>' +
      '<span class="nodeLabel">' + escapeHtml(node.label) + '</span>' +
      '<span class="nodeSummary">' + escapeHtml(node.summary) + '</span>' +
      '</button>';
  }).join('');

  elements.mapContent.className = '';
  elements.mapContent.innerHTML =
    '<div class="mapHeader">' +
      '<h2>' + escapeHtml(map.title) + '</h2>' +
      '<div class="mapOverview">' + escapeHtml(map.overview) + '</div>' +
      '<div class="mapMeta">' +
        '<span class="badge">' + escapeHtml(map.language) + '</span>' +
        '<span class="badge">' + escapeHtml(map.learningLevel) + '</span>' +
        '<span class="badge">' + map.edges.length + ' relationships</span>' +
      '</div>' +
    '</div>' +
    '<div id="knowledgeMapHost" class="mapHost">Rendering visual map...</div>' +
    '<div class="nodeGrid">' + cards + '</div>';

  elements.mapContent.querySelectorAll('[data-node-id]').forEach(button => {
    button.addEventListener('click', () => exploreNode(button.dataset.nodeId));
  });

  renderPath();
  void renderMapDiagram(map);
}

async function renderMiniDiagram(detail) {
  const host = document.getElementById('miniDiagramHost');
  if (!host || !detail.visualMermaid || !window.mermaid) return;

  const theme =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
      ? 'dark'
      : 'default';

  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true }
  });

  try {
    const result = await window.mermaid.render(
      'knowledge-node-visual-' + Date.now(),
      detail.visualMermaid
    );
    host.innerHTML = result.svg;
  } catch (error) {
    host.innerHTML =
      '<div class="mapError">Visual rendering error: ' +
      escapeHtml(error && error.message ? error.message : String(error)) +
      '</div>';
  }
}

function listSection(title, values, ordered) {
  if (!values || !values.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return '<h3>' + escapeHtml(title) + '</h3><' + tag + '>' +
    values.map(value => '<li>' + escapeHtml(value) + '</li>').join('') +
    '</' + tag + '>';
}

function renderDetail(detail) {
  currentDetail = detail;
  const related = (detail.relatedConcepts || []).map(item =>
    '<button class="chip relatedChip" data-query="' + escapeHtml(item.query) + '">' +
      escapeHtml(item.label) +
      '<span class="relationship">' + escapeHtml(item.relationship) + '</span>' +
    '</button>'
  ).join('');

  const suggestions = (detail.suggestedQuestions || []).map(question =>
    '<button class="chip questionChip" data-query="' + escapeHtml(question) + '">' +
      escapeHtml(question) +
    '</button>'
  ).join('');

  const sources = (detail.sources || []).map(source =>
    '<div class="sourceItem"><strong>' + escapeHtml(source.file_name) + '</strong><br>' +
      escapeHtml(sourcePages(source)) +
    '</div>'
  ).join('');

  const quiz = detail.knowledgeCheck
    ? '<h3>Knowledge check</h3>' +
      '<p><strong>' + escapeHtml(detail.knowledgeCheck.question) + '</strong></p>' +
      detail.knowledgeCheck.options.map((option, index) =>
        '<button class="quizOption" data-quiz-index="' + index + '">' +
          String.fromCharCode(65 + index) + '. ' + escapeHtml(option) +
        '</button>'
      ).join('') +
      '<div id="quizFeedback" class="quizFeedback hidden"></div>'
    : '';

  const visual = detail.visualMermaid
    ? '<h3>' + escapeHtml(detail.visualTitle || 'Visual explanation') + '</h3>' +
      '<div id="miniDiagramHost" class="miniDiagram">Rendering visual explanation...</div>'
    : '';

  elements.detail.innerHTML =
    '<div class="nodeCategory">' + escapeHtml(detail.category) + '</div>' +
    '<h2>' + escapeHtml(detail.title) + '</h2>' +
    '<p>' + escapeHtml(detail.overview) + '</p>' +
    '<div class="actionRow">' +
      '<button id="createDocument">Create Document</button>' +
      '<button id="askAssistant" class="secondary">Ask in Assistant</button>' +
    '</div>' +
    '<h3>Why it matters</h3>' +
    '<p>' + escapeHtml(detail.whyItMatters) + '</p>' +
    listSection('Key ideas', detail.keyIdeas, false) +
    listSection('How it works', detail.steps, true) +
    visual +
    listSection('Common misunderstandings', detail.commonMisunderstandings, false) +
    (related ? '<h3>Related concepts</h3><div class="chipGrid">' + related + '</div>' : '') +
    (suggestions ? '<h3>Keep exploring</h3><div class="chipGrid">' + suggestions + '</div>' : '') +
    quiz +
    '<div class="deepDive">' +
      '<h3>Ask a deeper question</h3>' +
      '<textarea id="deepDiveQuestion" placeholder="Ask anything about this concept..."></textarea>' +
      '<div class="actionRow"><button id="exploreQuestion">Explore Question</button></div>' +
    '</div>' +
    (sources ? '<h3>Evidence sources</h3><div class="sourceList">' + sources + '</div>' : '');

  elements.detail.querySelectorAll('[data-query]').forEach(button => {
    button.addEventListener('click', () => {
      const query = button.dataset.query || '';
      if (query) vscode.postMessage({ type: 'exploreQuestion', question: query });
    });
  });

  const createDocument = document.getElementById('createDocument');
  if (createDocument) {
    createDocument.addEventListener('click', () => {
      const prompt =
        'Create an evidence-grounded learning guide about ' + detail.title +
        '. Include why it matters, key concepts, practical steps, relationships, a visual explanation, and source citations.';
      vscode.postMessage({ type: 'createDocument', prompt });
    });
  }

  const askAssistant = document.getElementById('askAssistant');
  if (askAssistant) {
    askAssistant.addEventListener('click', () => {
      vscode.postMessage({
        type: 'askChat',
        query: 'Explain ' + detail.title + ' in detail using the strongest available evidence.'
      });
    });
  }

  const exploreQuestion = document.getElementById('exploreQuestion');
  if (exploreQuestion) {
    exploreQuestion.addEventListener('click', () => {
      const input = document.getElementById('deepDiveQuestion');
      const question = input && input.value ? input.value.trim() : '';
      if (question) vscode.postMessage({ type: 'exploreQuestion', question });
    });
  }

  elements.detail.querySelectorAll('[data-quiz-index]').forEach(button => {
    button.addEventListener('click', () => {
      if (!detail.knowledgeCheck) return;
      const selected = Number(button.dataset.quizIndex);
      const correct = detail.knowledgeCheck.correctIndex;
      elements.detail.querySelectorAll('[data-quiz-index]').forEach(option => {
        const index = Number(option.dataset.quizIndex);
        option.classList.toggle('correct', index === correct);
        option.classList.toggle('incorrect', index === selected && selected !== correct);
        option.disabled = true;
      });
      const feedback = document.getElementById('quizFeedback');
      if (feedback) {
        feedback.classList.remove('hidden');
        feedback.textContent =
          (selected === correct ? 'Correct. ' : 'Not quite. ') +
          detail.knowledgeCheck.explanation;
      }
    });
  });

  if (detail.visualMermaid) void renderMiniDiagram(detail);
}

function applyState(state, seedTopic) {
  explorerState = state || {};
  currentMap = explorerState.map;
  currentDetail = explorerState.detail;

  if (seedTopic) elements.topic.value = seedTopic;
  elements.level.value = explorerState.learningLevel || 'New to the topic';
  elements.mode.value = explorerState.retrievalMode || 'deep';

  if (currentMap) {
    elements.topic.value = currentMap.topic || elements.topic.value;
    renderMap(currentMap);
  } else {
    elements.versionBadge.textContent = 'Waiting for map';
    elements.mapContent.className = 'emptyMap';
    elements.mapContent.textContent = 'Building the overall knowledge map...';
    elements.pathList.innerHTML = '';
    updateProgress();
  }

  if (currentDetail) {
    renderDetail(currentDetail);
  } else {
    elements.detail.innerHTML =
      '<div class="detailEmpty">Select any concept in the map or learning path to start digging deeper.</div>';
  }
}

elements.generateMap.addEventListener('click', () => {
  vscode.postMessage({
    type: 'generateMap',
    topic: elements.topic.value,
    learningLevel: elements.level.value,
    mode: elements.mode.value
  });
});

elements.clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

elements.previousNode.addEventListener('click', () => {
  if (!currentMap) return;
  const index = selectedIndex();
  if (index > 0) exploreNode(currentMap.guidedOrder[index - 1]);
});

elements.nextNode.addEventListener('click', () => {
  if (!currentMap || !currentMap.guidedOrder.length) return;
  const index = selectedIndex();
  if (index < 0) {
    exploreNode(currentMap.guidedOrder[0]);
  } else if (index < currentMap.guidedOrder.length - 1) {
    exploreNode(currentMap.guidedOrder[index + 1]);
  }
});

window.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'busy') setBusy(message.busy, message.status);
  if (message.type === 'progress') elements.status.textContent = message.status || '';
  if (message.type === 'error') elements.error.textContent = message.message || 'Unknown error';
  if (message.type === 'seedTopic' && message.topic) elements.topic.value = message.topic;
  if (message.type === 'state') {
    elements.error.textContent = '';
    applyState(message.state, message.seedTopic);
  }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
