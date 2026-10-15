
const vscode = require('vscode');
const crypto = require('crypto');
const { io } = require('socket.io-client');

const VIEW_ID = 'bingo.gameView';

class BingoViewProvider {
    constructor(context) {
        this.context = context;
        this.view = undefined;
        this.socket = undefined;
        this.connectionAttempt = 0;
    }

    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(message => {
            if (!message || typeof message.type !== 'string') return;

            if (message.type === 'connect') {
                this.connect(message);
                return;
            }

            if (message.type === 'send') {
                if (this.socket?.connected) {
                    this.socket.emit('message', message.data);
                } else {
                    this.postMessage({
                        type: 'transport',
                        connected: false,
                        text: '🔌',
                        statusText: 'Not connected to the Bingo server.'
                    });
                }
            }
        }, undefined, this.context.subscriptions);

        this.context.subscriptions.push({
            dispose: () => this.disconnect()
        });
    }

    postMessage(message) {
        this.view?.webview.postMessage(message);
    }

    disconnect() {
        this.connectionAttempt++;

        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = undefined;
        }
    }

    connect(message) {
        const attempt = ++this.connectionAttempt;

        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = undefined;
        }

        try {
            const url = new URL(message.url);

            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new Error('Use an HTTP or HTTPS server URL.');
            }

            if (!message.passcode?.trim()) {
                throw new Error('Enter the Bingo passcode.');
            }

            const basePath = url.pathname.replace(/\/+$/, '');
            const socketPath = (basePath || '') + '/socket.io';

            this.postMessage({
                type: 'transport',
                connected: false,
                text: '🔄',
                statusText: 'Connecting to Bingo server...'
            });

            const socket = io(url.origin, {
                path: socketPath,
                auth: { passcode: message.passcode },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                timeout: 10000,
                transports: ['polling', 'websocket']
            });

            this.socket = socket;

            socket.on('connect', () => {
                if (attempt !== this.connectionAttempt) return;

                this.postMessage({
                    type: 'transport',
                    connected: true,
                    text: '🟢',
                    statusText: 'Connected. Synchronizing game...'
                });
            });

            socket.on('connect_error', error => {
                if (attempt !== this.connectionAttempt) return;

                this.postMessage({
                    type: 'transport',
                    connected: false,
                    text: '🔴',
                    statusText: 'Connection failed: ' + error.message
                });
            });

            socket.on('message', data => {
                if (attempt !== this.connectionAttempt) return;

                this.postMessage({
                    type: 'server-message',
                    data
                });
            });

            socket.on('disconnect', reason => {
                if (attempt !== this.connectionAttempt) return;

                this.postMessage({
                    type: 'transport',
                    connected: false,
                    text: '⚠️',
                    statusText: 'Disconnected: ' + reason
                });
            });
        } catch (error) {
            this.postMessage({
                type: 'transport',
                connected: false,
                text: '🔴',
                statusText: error.message || 'Unable to connect.'
            });
        }
    }

    getHtml() {
        const nonce = crypto.randomBytes(16).toString('hex');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
 content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">

<style nonce="${nonce}">
* { box-sizing: border-box; }

body {
    margin: 0;
    padding: 8px;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
}

h2 { font-size: 15px; margin: 0 0 2px; }

.subtitle {
    font-size: 10px;
    opacity: .7;
    margin-bottom: 8px;
}

.connection-panel, .board-wrap, details {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 5px;
}

.connection-panel {
    margin-bottom: 8px;
    padding: 6px;
}

.connection-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
}

.connection-heading strong { flex: 1; }

#status {
    display: inline-block;
    width: auto;
    padding: 0;
    margin: 0;
    border: none;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
}

input, button {
    width: 100%;
    min-width: 0;
    padding: 6px;
    border-radius: 4px;
    font: inherit;
}

input {
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
}

button {
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 1px solid transparent;
}

button:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
}

button:disabled {
    opacity: .45;
    cursor: not-allowed;
}

#connectionFields {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 6px;
}

#connectionFields input,
#connectionFields button {
    padding: 5px 6px;
}

button.toggle-btn {
    width: auto;
    padding: 3px 6px;
    font-size: 10px;
}

#gameStatus {
    padding: 7px;
    margin-bottom: 8px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 5px;
    font-size: 11px;
    overflow-wrap: anywhere;
}

#winnerBanner {
    display: none;
    padding: 7px;
    margin-bottom: 8px;
    text-align: center;
    font-weight: bold;
    background: var(--vscode-testing-iconPassed);
    color: white;
    border-radius: 5px;
}

.board-wrap { padding: 6px; }

.board-wrap.winner-board {
    border: 2px solid var(--vscode-testing-iconPassed);
}

.board-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 5px;
}

.board-title {
    font-weight: bold;
    font-size: 11px;
}

.turn-indicator {
    font-size: 10px;
    font-weight: bold;
    white-space: nowrap;
    color: var(--vscode-descriptionForeground);
}

.turn-indicator.my-turn {
    color: var(--vscode-testing-iconPassed);
}

#myBoard {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 3px;
    width: 100%;
}

.cell {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    padding: 0;
    min-width: 0;
    font-size: clamp(10px, 3vw, 15px);
    font-weight: bold;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
}

.cell.marked {
    color: white;
    background: var(--vscode-testing-iconPassed);
    border-color: var(--vscode-testing-iconPassed);
}

.cell:disabled:not(.marked) {
    opacity: 1;
    background: var(--vscode-editor-background);
}

.winner-stamp {
    display: none;
    text-align: center;
    font-weight: bold;
    margin-top: 5px;
    font-size: 11px;
}

.winner-board .winner-stamp { display: block; }

.actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
    margin: 7px 0 9px;
}

.actions button {
    padding: 6px 3px;
    font-size: 11px;
}

details {
    margin-top: 8px;
    padding: 6px;
}

summary {
    cursor: pointer;
    font-size: 11px;
    font-weight: bold;
}

#logList {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
    max-height: 120px;
    overflow-y: auto;
}

#logList li {
    padding: 4px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 10px;
    overflow-wrap: anywhere;
}
</style>
</head>

<body>
    <h2>🎱 Bingo</h2>
    <div class="subtitle">Multiplayer · Two players · Five lines to win</div>

    <div class="connection-panel" id="connectionPanel">
        <div class="connection-heading">
            <strong>Connection</strong>
            <span id="status" title="Not connected">🔌</span>
            <button id="toggleConnection" class="toggle-btn" type="button">Hide ▲</button>
        </div>

        <div id="connectionFields">
            <input id="server" type="url"
                value="https://hackend.in/bingob"
                placeholder="Server URL" aria-label="Server URL">
            <input id="passcode" type="password"
                placeholder="Bingo passcode"
                autocomplete="off" aria-label="Bingo passcode">
            <button id="connect" type="button">Connect</button>
        </div>
    </div>

    <div id="gameStatus">Connect to the server and wait for a friend.</div>
    <div id="winnerBanner" role="status"></div>

    <div class="board-wrap" id="myWrap">
        <div class="board-heading">
            <div class="board-title">🎯 Your Board</div>
            <div id="turnIndicator" class="turn-indicator">⏳ Waiting</div>
        </div>
        <div id="myBoard"></div>
        <div class="winner-stamp">🏆 YOU WON BINGO!</div>
    </div>

    <div class="actions">
        <button id="ready" disabled>Ready</button>
        <button id="newGame" disabled>New Game</button>
    </div>

    <details>
        <summary>📜 Game Action Log</summary>
        <ul id="logList"></ul>
    </details>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

let playerId = null;
let connected = false;
let registered = false;
let started = false;
let currentTurn = null;
let winner = null;

let marked = new Set();
let readyPlayers = new Set();
let serverPlayers = [];
let previousState = null;

const logEntries = [];
const ownBoard = shuffle(Array.from({ length: 25 }, (_, i) => i + 1));

function shuffle(array) {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

function sendData(data) {
    if (!connected) return;
    vscode.postMessage({ type: 'send', data });
}

function addLog(message) {
    logEntries.push(new Date().toLocaleTimeString() + ' — ' + message);
    if (logEntries.length > 100) logEntries.shift();

    const list = document.getElementById('logList');
    list.replaceChildren();

    for (const entry of logEntries) {
        const li = document.createElement('li');
        li.textContent = entry;
        list.appendChild(li);
    }

    list.scrollTop = list.scrollHeight;
}

function getFriend() {
    return serverPlayers.find(p => p.id !== playerId) || null;
}

function playerLabel(id) {
    if (!id) return 'Unknown player';
    return id === playerId ? 'You' : 'Friend';
}

function renderBoard() {
    const board = document.getElementById('myBoard');
    const wrap = document.getElementById('myWrap');

    board.replaceChildren();
    wrap.classList.toggle('winner-board', winner === playerId);

    for (const number of ownBoard) {
        const cell = document.createElement('button');
        cell.className = 'cell';
        cell.textContent = String(number);

        if (marked.has(number)) cell.classList.add('marked');

        cell.disabled = !(
            connected && registered && started &&
            currentTurn === playerId && !winner &&
            !marked.has(number)
        );

        cell.setAttribute(
            'aria-label',
            'Number ' + number + (marked.has(number) ? ', marked' : '')
        );

        cell.addEventListener('click', () => {
            if (
                !connected || !registered || !started ||
                currentTurn !== playerId || winner || marked.has(number)
            ) return;

            sendData({ type: 'move', number });
        });

        board.appendChild(cell);
    }
}

function render() {
    renderBoard();

    const friend = getFriend();
    const readyButton = document.getElementById('ready');

    readyButton.disabled = !(
        connected && registered && friend &&
        serverPlayers.length === 2 && !started &&
        !winner && !readyPlayers.has(playerId)
    );

    readyButton.textContent =
        readyPlayers.has(playerId) ? 'Ready ✓' : 'Ready';

    document.getElementById('newGame').disabled = !connected;
}

function updateStatus() {
    const status = document.getElementById('gameStatus');
    const friend = getFriend();
    const indicator = document.getElementById('turnIndicator');

    let message = '';

    if (!connected) {
        message = 'Connect to the server to start playing.';
    } else if (!playerId || !registered) {
        message = 'Registering your board...';
    } else if (!friend) {
        message = 'Connected. Waiting for your friend to join...';
    } else if (!started && !winner) {
        message =
            'You: ' + (readyPlayers.has(playerId) ? 'Ready ✓' : 'Not ready') +
            ' | Friend: ' +
            (readyPlayers.has(friend.id) ? 'Ready ✓' : 'Not ready') +
            '. Both players must be ready.';
    }

    status.textContent = message;
    status.style.display = message ? 'block' : 'none';

    if (!connected || !registered) {
        indicator.textContent = '⏳ Waiting';
        indicator.classList.remove('my-turn');
    } else if (winner) {
        indicator.textContent =
            winner === playerId ? '🏆 You won!' : '🏆 Friend won';
        indicator.classList.remove('my-turn');
    } else if (!started) {
        indicator.textContent = '⏳ Waiting';
        indicator.classList.remove('my-turn');
    } else if (currentTurn === playerId) {
        indicator.textContent = '🟢 Your turn';
        indicator.classList.add('my-turn');
    } else {
        indicator.textContent = '🔴 Friend’s turn';
        indicator.classList.remove('my-turn');
    }
}

function applyServerState(state) {
    if (!state || !Array.isArray(state.players)) return;

    const old = previousState;
    const oldMarked = new Set(old?.marked || []);
    const newMarked = new Set(state.marked || []);

    serverPlayers = state.players;
    marked = newMarked;
    started = Boolean(state.started);
    currentTurn = state.currentTurn || null;
    winner = state.winner || null;

    readyPlayers = new Set(
        state.players.filter(p => p.ready).map(p => p.id)
    );

    registered = Boolean(
        playerId && state.players.some(
            p => p.id === playerId && p.hasBoard
        )
    );

    if (old) {
        for (const number of newMarked) {
            if (!oldMarked.has(number)) {
                addLog('Number ' + number + ' was selected.');
            }
        }

        for (const p of state.players) {
            const oldPlayer = old.players.find(x => x.id === p.id);
            if (p.ready && !oldPlayer?.ready) {
                addLog(playerLabel(p.id) + ' is ready.');
            }
        }

        if (!old.started && state.started) {
            addLog('Game started. First turn: ' + playerLabel(state.currentTurn) + '.');
        }

        if (!old.winner && state.winner) {
            addLog(playerLabel(state.winner) + ' WON BINGO with five completed lines!');
        }

        if (old.started && !state.started && !state.winner &&
            (state.marked || []).length === 0) {
            addLog('Game reset. Both players must ready up again.');
        }

        if (old.players.length < state.players.length) {
            addLog('A friend joined the game.');
        }

        if (old.players.length > state.players.length) {
            addLog('A friend disconnected.');
        }
    } else {
        addLog('Received the current game state from the server.');
    }

    previousState = {
        players: state.players.map(p => ({ ...p })),
        started: state.started,
        currentTurn: state.currentTurn,
        winner: state.winner,
        marked: [...(state.marked || [])]
    };

    const banner = document.getElementById('winnerBanner');

    if (winner) {
        banner.textContent = '🏆 ' + playerLabel(winner) + ' WON BINGO!';
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
    }

    updateStatus();
    render();
}

function handleServerMessage(data) {
    if (!data || typeof data.type !== 'string') return;

    if (data.type === 'welcome') {
        playerId = data.playerId;

        if (!playerId) {
            addLog('Server did not provide a player ID.');
            return;
        }

        addLog('Authenticated. Player ID assigned.');
        sendData({ type: 'registerBoard', board: ownBoard });
        updateStatus();
        render();
        return;
    }

    if (data.type === 'serverState') {
        applyServerState(data.state);
        return;
    }

    if (data.type === 'error') {
        addLog('Server error: ' + data.message);
    }
}

function resetClientState() {
    playerId = null;
    registered = false;
    started = false;
    currentTurn = null;
    winner = null;

    marked.clear();
    readyPlayers.clear();
    serverPlayers = [];
    previousState = null;

    document.getElementById('winnerBanner').style.display = 'none';
    updateStatus();
    render();
}

const connectionPanel = document.getElementById('connectionPanel');
const connectionFields = document.getElementById('connectionFields');
const toggleConnection = document.getElementById('toggleConnection');

let connectionSettingsHidden = false;

function updateConnectionPanel() {
    connectionFields.style.display =
        connectionSettingsHidden ? 'none' : 'flex';

    toggleConnection.textContent =
        connectionSettingsHidden ? 'Settings ▼' : 'Hide ▲';
}

toggleConnection.addEventListener('click', () => {
    connectionSettingsHidden = !connectionSettingsHidden;
    updateConnectionPanel();
});

document.getElementById('connect').addEventListener('click', () => {
    const url = document.getElementById('server').value.trim();
    const passcode = document.getElementById('passcode').value;
    const statusElement = document.getElementById('status');

    if (!url || !passcode.trim()) {
        statusElement.textContent = '🔴';
        statusElement.title = 'Enter the server URL and passcode.';
        return;
    }

    resetClientState();
    statusElement.textContent = '🔄';
    statusElement.title = 'Connecting to Bingo server...';

    vscode.postMessage({ type: 'connect', url, passcode });
});

document.getElementById('ready').addEventListener('click', () => {
    if (
        !connected || !registered || !getFriend() ||
        readyPlayers.has(playerId)
    ) return;

    sendData({ type: 'ready' });
});

document.getElementById('newGame').addEventListener('click', () => {
    if (connected) sendData({ type: 'newGame' });
});

window.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'transport') {
        connected = Boolean(message.connected);

        const statusElement = document.getElementById('status');
        statusElement.textContent = message.text || (connected ? '🟢' : '🔴');
        statusElement.title = message.statusText || message.text || '';

        if (connected) {
            connectionSettingsHidden = true;
            updateConnectionPanel();
            resetClientState();
            addLog('Connected. Waiting for server identity...');
        } else {
            resetClientState();
            addLog('Connection lost or failed.');
        }

        updateStatus();
        render();
        return;
    }

    if (message.type === 'server-message') {
        handleServerMessage(message.data);
    }
});

updateConnectionPanel();
addLog('Bingo initialized. Connect to begin.');
updateStatus();
render();
</script>
</body>
</html>`;
    }
}

function activate(context) {
    const provider = new BingoViewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            VIEW_ID,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('bingo.open', async () => {
            await vscode.commands.executeCommand('workbench.view.explorer');
            await vscode.commands.executeCommand('bingo.gameView.focus');
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
