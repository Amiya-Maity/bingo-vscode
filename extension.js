
const vscode = require('vscode');
const crypto = require('crypto');
const { io } = require('socket.io-client');

const VIEW_ID = 'bingo.gameView';
const DEFAULT_SERVER_URL = 'https://hackend.in/bingob';
const SOCKET_PATH = '/bingob/socket.io';

class BingoViewProvider {
    constructor(context) {
        this.context = context;
        this.view = null;
        this.socket = null;
        this.playerId = null;
        this.currentBoard = null;
        this.currentDisplayName = '';
        this.latestWelcome = null;
        this.latestServerMessage = null;
        this.connectionStatus = {
            icon: '🔴',
            text: 'Not connected',
            connected: false
        };
    }

    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();

        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'connect':
                    await this.connect(message);
                    break;
                case 'send':
                    this.send(message.payload);
                    break;
                case 'disconnect':
                    this.disconnect();
                    break;
            }
        });

        this.post({
            command: 'init',
            savedName: this.context.globalState.get('bingo.playerName', ''),
            serverUrl: DEFAULT_SERVER_URL,
            status: this.connectionStatus
        });

        if (this.socket?.connected && this.latestWelcome) {
            this.post({
                command: 'welcome',
                ...this.latestWelcome,
                replay: true
            });

            if (this.latestServerMessage) {
                this.post({
                    command: 'serverMessage',
                    payload: this.latestServerMessage
                });
            }
        }
    }

    post(message) {
        if (this.view) {
            this.view.webview.postMessage(message);
        }
    }

    setStatus(icon, text, connected = false) {
        this.connectionStatus = { icon, text, connected };
        this.post({
            command: 'status',
            status: this.connectionStatus
        });
    }

    generateBoard() {
        const board = Array.from({ length: 25 }, (_, index) => index + 1);

        for (let i = board.length - 1; i > 0; i--) {
            const j = crypto.randomInt(i + 1);
            [board[i], board[j]] = [board[j], board[i]];
        }

        return board;
    }

    async connect(options) {
        const serverUrl = String(options.serverUrl || '')
            .trim()
            .replace(/\/+$/, '');

        const passcode = String(options.passcode || '').trim();
        const displayName = String(options.displayName || '')
            .trim()
            .replace(/[\u0000-\u001F\u007F]/g, '')
            .slice(0, 24);

        if (!displayName) {
            this.post({ command: 'error', message: 'Please enter your player name.' });
            return;
        }

        if (!passcode) {
            this.post({ command: 'error', message: 'Please enter a room passcode.' });
            return;
        }

        let parsedUrl;

        try {
            parsedUrl = new URL(serverUrl);
        } catch {
            this.post({ command: 'error', message: 'Please enter a valid server URL.' });
            return;
        }

        if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
            this.post({
                command: 'error',
                message: 'The server URL must use HTTP or HTTPS.'
            });
            return;
        }

        await this.context.globalState.update('bingo.playerName', displayName);

        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        this.playerId = null;
        this.currentBoard = null;
        this.currentDisplayName = displayName;
        this.latestWelcome = null;
        this.latestServerMessage = null;

        this.post({ command: 'reset' });
        this.setStatus('🔄', 'Connecting...');

        console.log('[BINGO][CONNECT] Starting connection:', {
            server: parsedUrl.origin,
            path: SOCKET_PATH,
            displayName
        });

        const socket = io(parsedUrl.origin, {
            path: SOCKET_PATH,
            auth: { passcode, displayName },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            timeout: 10000
        });

        this.socket = socket;

        socket.on('connect', () => {
            if (this.socket !== socket) return;

            console.log('[BINGO][SOCKET] Connected:', {
                server: parsedUrl.origin,
                path: SOCKET_PATH,
                socketId: socket.id,
                transport: socket.io.engine?.transport?.name
            });

            this.setStatus('🟢', 'Connected', true);
            this.post({ command: 'connected' });
        });

        socket.on('connect_error', error => {
            if (this.socket !== socket) return;

            console.error('[BINGO][SOCKET] Connection error:', {
                message: error.message,
                description: error.description,
                context: error.context
            });

            this.setStatus('🔴', 'Connection failed');
            this.post({
                command: 'error',
                message: error.message || 'Could not connect to the Bingo server.'
            });
        });

        socket.on('message', message => {
            if (this.socket !== socket || !message) return;

            console.log('[BINGO][SOCKET] Received from backend:', message);

            if (message.type === 'welcome') {
                this.playerId = message.playerId;
                this.currentBoard = this.generateBoard();

                this.latestWelcome = {
                    playerId: this.playerId,
                    displayName: message.displayName || displayName,
                    board: this.currentBoard
                };

                console.log('[BINGO][WELCOME] Player received:', {
                    playerId: this.playerId,
                    displayName: message.displayName || displayName,
                    boardLength: this.currentBoard.length
                });

                this.post({
                    command: 'welcome',
                    ...this.latestWelcome,
                    replay: false
                });

                return;
            }

            if (message.type === 'serverState') {
                this.latestServerMessage = message;
            }

            this.post({
                command: 'serverMessage',
                payload: message
            });

            if (message.type === 'error') {
                console.error('[BINGO][BACKEND ERROR]', message);

                this.post({
                    command: 'error',
                    message: message.message || 'The server reported an error.'
                });
            }
        });

        socket.on('disconnect', reason => {
            if (this.socket !== socket) return;

            console.warn('[BINGO][SOCKET] Disconnected:', reason);

            this.playerId = null;
            this.latestWelcome = null;
            this.latestServerMessage = null;

            this.setStatus('🔴', 'Disconnected');
            this.post({ command: 'disconnected', reason });
        });
    }

    send(payload) {
        if (!payload) {
            console.warn('[BINGO][SOCKET] Refusing to send an empty payload.');
            return;
        }

        if (!this.socket?.connected) {
            console.error('[BINGO][SOCKET] Cannot send: socket is disconnected.', payload);
            this.post({
                command: 'error',
                message: 'Not connected to the Bingo server. Check the connection status.'
            });
            return;
        }

        console.log('[BINGO][SOCKET] Sending to backend:', payload);
        this.socket.emit('message', payload);
    }

    disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }

        this.playerId = null;
        this.currentBoard = null;
        this.latestWelcome = null;
        this.latestServerMessage = null;

        this.setStatus('🔴', 'Not connected');
        this.post({ command: 'reset' });
    }

    getHtml() {
        const nonce = crypto.randomBytes(16).toString('base64');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy"
 content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Multiplayer Bingo</title>
<style>
* { box-sizing: border-box; }
body {
    padding: 10px;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
}
h2 { margin: 0 0 12px; font-size: 17px; }
h3 { margin: 14px 0 8px; font-size: 13px; }
.muted { color: var(--vscode-descriptionForeground); }
.panel {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 10px;
}
.row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.field { margin-bottom: 9px; }
label {
    display: block;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
}
input {
    width: 100%;
    padding: 7px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px;
    outline-color: var(--vscode-focusBorder);
}
button {
    cursor: pointer;
    font: inherit;
    padding: 7px 9px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: 1px solid transparent;
    border-radius: 4px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: .45; cursor: not-allowed; }
button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
}
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.full { width: 100%; }
.small { font-size: 11px; line-height: 1.5; }
.hidden { display: none !important; }
#statusText {
    margin: 7px 0;
    font-size: 12px;
    overflow-wrap: anywhere;
}
#error {
    color: var(--vscode-errorForeground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 12px;
    margin-top: 8px;
}
#game { display: none; }
#players { font-size: 12px; line-height: 1.8; margin-top: 6px; }
.player-row { overflow-wrap: anywhere; padding: 2px 0; }
.current-player { color: var(--vscode-textLink-foreground); font-weight: 600; }
#gameStatus {
    font-size: 12px;
    line-height: 1.5;
    margin-top: 8px;
    color: var(--vscode-descriptionForeground);
    overflow-wrap: anywhere;
}
#winnerBanner {
    display: none;
    text-align: center;
    font-weight: 600;
    padding: 10px;
    margin-bottom: 10px;
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 6px;
}
.board {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
}
.board-tools { display: flex; align-items: center; gap: 5px; }
#shuffleBtn { padding: 5px 7px; font-size: 11px; white-space: nowrap; }
.board-hint {
    margin: 5px 0 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.4;
}
.cell.dragging { opacity: .4; border: 1px dashed var(--vscode-focusBorder); }
.cell.drop-target { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px; }
.cell.editable { cursor: grab; border-color: var(--vscode-button-border, var(--vscode-panel-border)); }
.cell.editable:active { cursor: grabbing; }
.cell {
    width: 100%;
    min-width: 0;
    aspect-ratio: 1;
    padding: 0;
    font-size: 13px;
    font-weight: 600;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
    overflow: hidden;
}
.cell.marked {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-focusBorder);
}
.cell.my-turn:not(.marked) { border-color: var(--vscode-focusBorder); }
.actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    margin-top: 10px;
}
#turnIndicator {
    text-align: right;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}
#log {
    max-height: 130px;
    overflow-y: auto;
    overflow-wrap: anywhere;
    font-size: 11px;
    line-height: 1.5;
}
.log-entry { padding: 3px 0; border-bottom: 1px solid var(--vscode-panel-border); }
</style>
</head>
<body>
<h2>🎯 Multiplayer Bingo</h2>

<div class="panel">
    <div class="row">
        <strong>Connection</strong>
        <span id="statusIcon">🔴</span>
    </div>
    <div id="statusText" class="muted">Not connected</div>
    <button id="settingsToggle" class="secondary full">⚙️ Connection settings</button>

    <div id="settingsPanel">
        <div class="field">
            <label for="playerName">Your name</label>
            <input id="playerName" maxlength="24" placeholder="Enter your name" autocomplete="nickname">
        </div>
        <div class="field">
            <label for="serverUrl">Server URL</label>
            <input id="serverUrl" type="url" value="\${DEFAULT_SERVER_URL}">
        </div>
        <div class="field">
            <label for="passcode">Room passcode</label>
            <input id="passcode" type="password" placeholder="Enter room passcode" autocomplete="off">
        </div>
        <button id="connectBtn" class="full">Connect to room</button>
        <p class="small muted">
            Share the same passcode with your friends to join one room.
            Different passcodes create separate rooms.
        </p>
    </div>
    <div id="error" role="alert"></div>
</div>

<div id="game">
    <div class="panel">
        <div class="row">
            <strong>Players</strong>
            <span id="playerCount" class="muted">0/20</span>
        </div>
        <div id="players" class="muted">Waiting for players...</div>
        <div id="gameStatus">Waiting for a connection.</div>
    </div>

    <div id="winnerBanner"></div>

    <div class="row" style="margin-bottom:5px">
        <strong id="boardTitle">🎯 Your Board</strong>
        <div class="board-tools">
            <button id="shuffleBtn" class="secondary" disabled title="Randomly rearrange numbers">🔀 Shuffle</button>
        </div>
    </div>

    <div id="turnIndicator" style="text-align:left;margin-bottom:6px">Waiting...</div>
    <p id="boardHint" class="board-hint">Drag a cell onto another to swap numbers, or use Shuffle for a random board.</p>
    <div id="board" class="board"></div>

    <div class="actions">
        <button id="readyBtn" disabled>✓ Ready</button>
        <button id="newGameBtn" class="secondary" disabled>↻ New Game</button>
    </div>

    <h3>📋 Game activity</h3>
    <div id="log" class="panel"></div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);

let playerId = null;
let displayName = '';
let connected = false;
let registered = false;
let board = [];
let marked = new Set();
let serverPlayers = [];
let started = false;
let currentTurn = null;
let winner = null;
let gameId = null;
let maxPlayers = 20;
let minPlayers = 2;
let readySent = false;
let newGamePending = false;
let previousState = null;
let draggedIndex = null;

function send(command, extra = {}) {
    vscode.postMessage({ command, ...extra });
}

function sendGame(payload) {
    send('send', { payload });
}

function addLog(text) {
    const item = document.createElement('div');
    item.className = 'log-entry';
    item.textContent = text;
    $('log').prepend(item);

    while ($('log').children.length > 50) {
        $('log').lastElementChild.remove();
    }
}

function getMe() {
    return serverPlayers.find(player => player.id === playerId);
}

function nameOf(id) {
    const player = serverPlayers.find(item => item.id === id);
    if (player) return player.name;
    if (id === playerId) return displayName || 'You';
    return 'Player';
}

function updateSettingsVisibility() {
    if (connected) {
        $('settingsPanel').classList.add('hidden');
        $('settingsToggle').textContent = '⚙️ Change connection settings';
    } else {
        $('settingsPanel').classList.remove('hidden');
        $('settingsToggle').textContent = '⚙️ Connection settings';
    }
}

function updateStatus(status) {
    $('statusIcon').textContent = status.icon || '🔴';
    $('statusText').textContent = status.text || 'Not connected';
    connected = Boolean(status.connected);

    $('connectBtn').disabled = status.text === 'Connecting...';
    $('connectBtn').textContent = connected
        ? 'Reconnect to room'
        : 'Connect to room';

    updateSettingsVisibility();

    if (connected) {
        $('game').style.display = 'block';
    }

    render();
}

function resetClientState() {
    playerId = null;
    connected = false;
    registered = false;
    board = [];
    marked = new Set();
    serverPlayers = [];
    started = false;
    currentTurn = null;
    winner = null;
    gameId = null;
    maxPlayers = 20;
    minPlayers = 2;
    readySent = false;
    newGamePending = false;
    previousState = null;
    renderStatus.lastDebugState = null;

    $('game').style.display = 'none';
    $('error').textContent = '';
    $('winnerBanner').style.display = 'none';
    $('board').replaceChildren();
    $('players').textContent = 'Waiting for players...';
    $('gameStatus').textContent = 'Waiting for a connection.';
    $('turnIndicator').textContent = 'Waiting...';
    $('playerCount').textContent = '0/20';
    $('log').replaceChildren();
    $('readyBtn').disabled = true;
    $('newGameBtn').disabled = true;
    $('shuffleBtn').disabled = true;

    updateSettingsVisibility();
}

function boardEditable() {
    return Boolean(
        connected &&
        playerId &&
        Array.isArray(board) &&
        board.length === 25 &&
        !started &&
        !winner &&
        !readySent &&
        !getMe()?.ready
    );
}

function registerUpdatedBoard() {
    if (!boardEditable()) {
        console.warn('[BINGO][BOARD] Board edit ignored because board is not editable.', {
            connected,
            playerId,
            started,
            winner,
            readySent,
            serverSaysReady: Boolean(getMe()?.ready)
        });
        render();
        return;
    }

    const validBoard = board.length === 25 &&
        new Set(board).size === 25 &&
        board.every(number =>
            Number.isInteger(number) && number >= 1 && number <= 25
        );

    if (!validBoard) {
        console.error('[BINGO][BOARD] Refusing to register invalid board:', board);
        addLog('[DEBUG] Board invalid; not sending registerBoard.');
        render();
        return;
    }

    registered = false;
    console.log('[BINGO][BOARD] Sending updated board registration:', board);
    addLog('[DEBUG] Sending board registration to server.');
    sendGame({ type: 'registerBoard', board: [...board] });
    render();
}

function shuffleBoard() {
    if (!boardEditable()) {
        console.warn('[BINGO][BOARD] Shuffle blocked: board is not editable.');
        return;
    }

    for (let i = board.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [board[i], board[j]] = [board[j], board[i]];
    }

    addLog('🔀 Board shuffled.');
    registerUpdatedBoard();
}

function renderBoard() {
    const container = $('board');
    container.replaceChildren();

    const editable = boardEditable();
    $('shuffleBtn').disabled = !editable;
    $('boardHint').textContent = editable
        ? 'Drag a cell onto another to swap numbers, or use Shuffle.'
        : 'Your board is locked after you press Ready or the game starts.';

    board.forEach((number, index) => {
        const cell = document.createElement('button');
        cell.className = 'cell';
        cell.textContent = String(number);
        cell.setAttribute('aria-label', 'Number ' + number);
        cell.draggable = editable;

        if (editable) cell.classList.add('editable');

        cell.addEventListener('dragstart', event => {
            if (!boardEditable()) {
                event.preventDefault();
                return;
            }

            draggedIndex = index;
            cell.classList.add('dragging');

            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(index));
            }
        });

        cell.addEventListener('dragend', () => {
            draggedIndex = null;
            container.querySelectorAll('.cell').forEach(item =>
                item.classList.remove('dragging', 'drop-target')
            );
        });

        cell.addEventListener('dragover', event => {
            if (!boardEditable() || draggedIndex === null || draggedIndex === index) return;

            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            cell.classList.add('drop-target');
        });

        cell.addEventListener('dragleave', () => {
            cell.classList.remove('drop-target');
        });

        cell.addEventListener('drop', event => {
            if (!boardEditable()) return;

            event.preventDefault();
            const sourceIndex = draggedIndex;
            draggedIndex = null;

            if (sourceIndex === null || sourceIndex === index) return;

            const first = board[sourceIndex];
            const second = board[index];
            [board[sourceIndex], board[index]] = [board[index], board[sourceIndex]];

            addLog('↔ Swapped ' + first + ' and ' + second + '.');
            registerUpdatedBoard();
        });

        const isMarked = marked.has(number);
        const myTurn = started && currentTurn === playerId;

        if (isMarked) {
            cell.classList.add('marked');
            cell.textContent = '✓ ' + number;
        }

        if (myTurn && !isMarked) {
            cell.classList.add('my-turn');
        }

        cell.disabled = !myTurn || isMarked || Boolean(winner) || !connected;

        cell.addEventListener('click', () => {
            if (!started || currentTurn !== playerId || marked.has(number)) {
                console.warn('[BINGO][MOVE] Click ignored:', {
                    number,
                    started,
                    currentTurn,
                    playerId,
                    alreadyMarked: marked.has(number)
                });
                return;
            }

            console.log('[BINGO][MOVE] Sending move:', number);
            sendGame({ type: 'move', number });
        });

        container.appendChild(cell);
    });
}

function renderPlayers() {
    $('playerCount').textContent = serverPlayers.length + '/' + maxPlayers;
    $('players').replaceChildren();

    if (serverPlayers.length === 0) {
        $('players').textContent = 'Waiting for players...';
        return;
    }

    serverPlayers.forEach((player, index) => {
        const line = document.createElement('div');
        line.className = 'player-row';

        const isMe = player.id === playerId;
        const isTurn = started && currentTurn === player.id;

        if (isTurn) line.classList.add('current-player');

        line.textContent =
            (isTurn ? '▶ ' : '👤 ') +
            (index + 1) + '. ' +
            player.name +
            (isMe ? ' (You)' : '') +
            ' — ' +
            (player.ready ? '✓ Ready' : 'Not ready') +
            (isTurn ? ' — Playing now' : '');

        $('players').appendChild(line);
    });
}

function renderStatus() {
    const me = getMe();

    $('winnerBanner').style.display = winner ? 'block' : 'none';
    $('winnerBanner').textContent = winner
        ? '🏆 ' + nameOf(winner) + ' wins!'
        : '';

    if (winner) {
        $('gameStatus').textContent =
            nameOf(winner) + ' won! Start a new game to play again.';
        $('turnIndicator').textContent = '🏆 Game over';
    } else if (serverPlayers.length < minPlayers) {
        $('gameStatus').textContent =
            'Waiting for at least ' + minPlayers +
            ' players. You can mark Ready now.';
        $('turnIndicator').textContent = 'Lobby';
    } else if (!started) {
        const notReady = serverPlayers.filter(
            player => !player.ready || !player.hasBoard
        );

        $('gameStatus').textContent = notReady.length
            ? 'Waiting for ' +
              notReady.map(player => player.name).join(', ') +
              ' to get ready.'
            : 'Everyone is ready. Waiting for the game to start.';

        $('turnIndicator').textContent = 'Lobby';
    } else if (currentTurn === playerId) {
        $('gameStatus').textContent =
            'Your turn! Select a number from your board.';
        $('turnIndicator').textContent = '👉 Your turn';
    } else {
        $('gameStatus').textContent =
            'Waiting for ' + nameOf(currentTurn) + ' to select a number.';
        $('turnIndicator').textContent =
            '⏳ ' + nameOf(currentTurn) + "'s turn";
    }

    const validBoard = Array.isArray(board) &&
        board.length === 25 &&
        new Set(board).size === 25 &&
        board.every(number =>
            Number.isInteger(number) && number >= 1 && number <= 25
        );

    const reasons = [];

    if (!connected) reasons.push('not connected');
    if (!playerId) reasons.push('playerId missing');
    if (!validBoard) reasons.push('board invalid/incomplete');
    if (!registered) reasons.push('server has not confirmed hasBoard=true');
    if (started) reasons.push('game already started');
    if (winner) reasons.push('winner already exists');
    if (readySent) reasons.push('ready request already sent');
    if (me?.ready) reasons.push('server says player is already ready');

    const canReady =
        connected &&
        Boolean(playerId) &&
        validBoard &&
        registered &&
        !started &&
        !winner &&
        !readySent &&
        !me?.ready;

    const debugState = JSON.stringify({
        connected,
        playerId,
        boardLength: Array.isArray(board) ? board.length : null,
        boardValid: validBoard,
        registered,
        me: me
            ? {
                id: me.id,
                name: me.name,
                ready: me.ready,
                hasBoard: me.hasBoard
            }
            : null,
        playerCount: serverPlayers.length,
        minPlayers,
        started,
        winner,
        readySent,
        canReady,
        reasons
    });

    if (debugState !== renderStatus.lastDebugState) {
        console.log('[BINGO][READY DIAGNOSTIC]', JSON.parse(debugState));

        if (reasons.length) {
            addLog('[DEBUG] Ready disabled: ' + reasons.join('; '));
        } else {
            addLog('[DEBUG] Ready button enabled.');
        }

        renderStatus.lastDebugState = debugState;
    }

    // The player count does not prevent you from marking Ready.
    $('readyBtn').disabled = !canReady;

    $('readyBtn').textContent = me?.ready
        ? '✓ You are Ready'
        : readySent
            ? '⏳ Sending Ready...'
            : '✓ Ready';

    $('newGameBtn').disabled = !connected || newGamePending;
}

function render() {
    if (connected && playerId) {
        $('game').style.display = 'block';
    }

    $('boardTitle').textContent = '🎯 ' + (displayName || 'Your') + "'s Board";

    renderPlayers();
    renderBoard();
    renderStatus();
}

function applyServerState(state) {
    if (!state) {
        console.warn('[BINGO][SERVER STATE] Empty state received.');
        return;
    }

    const old = previousState;
    const nextGameId = state.gameId ?? 1;

    if (gameId !== null && nextGameId !== gameId) {
        readySent = false;
        newGamePending = false;
        addLog('↻ New game. Everyone must press Ready again.');
    }

    gameId = nextGameId;
    maxPlayers = state.maxPlayers || 20;
    minPlayers = state.minPlayers || 2;

    serverPlayers = Array.isArray(state.players) ? state.players : [];
    marked = new Set(Array.isArray(state.marked) ? state.marked : []);

    started = Boolean(state.started);
    currentTurn = state.currentTurn || null;
    winner = state.winner || null;

    const me = getMe();
    registered = Boolean(me?.hasBoard);

    console.log('[BINGO][SERVER STATE]', {
        playerId,
        myPlayer: me || null,
        hasBoard: me?.hasBoard,
        registered,
        players: serverPlayers.map(player => ({
            id: player.id,
            name: player.name,
            ready: player.ready,
            hasBoard: player.hasBoard
        })),
        started,
        currentTurn,
        winner
    });

    if (!registered) {
        console.warn(
            '[BINGO][SERVER STATE] Server state does not confirm board registration.',
            {
                playerId,
                knownPlayerIds: serverPlayers.map(player => player.id)
            }
        );
    }

    if (newGamePending && !started && !winner) {
        newGamePending = false;
    }

    if (old) {
        for (const number of marked) {
            if (!old.marked.has(number)) {
                addLog(
                    '🔢 ' + nameOf(old.currentTurn) +
                    ' selected ' + number + '.'
                );
            }
        }

        if (!old.started && started) {
            addLog('🚀 Game started with ' + serverPlayers.length + ' players.');
        }

        if (!old.winner && winner) {
            addLog('🏆 ' + nameOf(winner) + ' won the game!');
        }

        if (old.players.length < serverPlayers.length) {
            const joined = serverPlayers.filter(player =>
                !old.players.some(oldPlayer => oldPlayer.id === player.id)
            );

            joined.forEach(player => {
                addLog('👋 ' + player.name + ' joined the room.');
            });
        }

        if (old.players.length > serverPlayers.length) {
            addLog('⚠️ A player left the room.');
        }
    } else {
        addLog('Connected to the Bingo room.');
    }

    previousState = {
        gameId,
        marked: new Set(marked),
        started,
        winner,
        currentTurn,
        players: serverPlayers.map(player => ({ ...player }))
    };

    render();
}

$('settingsToggle').addEventListener('click', () => {
    $('settingsPanel').classList.toggle('hidden');
    $('settingsToggle').textContent =
        $('settingsPanel').classList.contains('hidden')
            ? '⚙️ Change connection settings'
            : '⚙️ Hide connection settings';
});

$('connectBtn').addEventListener('click', () => {
    const name = $('playerName').value.trim();
    const passcode = $('passcode').value.trim();

    $('error').textContent = '';

    if (!name) {
        $('error').textContent = 'Please enter your name.';
        $('playerName').focus();
        return;
    }

    if (!passcode) {
        $('error').textContent = 'Please enter a room passcode.';
        $('passcode').focus();
        return;
    }

    displayName = name;

    send('connect', {
        displayName: name,
        serverUrl: $('serverUrl').value.trim(),
        passcode: $('passcode').value
    });
});

$('playerName').addEventListener('keydown', event => {
    if (event.key === 'Enter') $('connectBtn').click();
});

$('passcode').addEventListener('keydown', event => {
    if (event.key === 'Enter') $('connectBtn').click();
});

$('shuffleBtn').addEventListener('click', shuffleBoard);

$('readyBtn').addEventListener('click', () => {
    const me = getMe();

    console.log('[BINGO][READY CLICK]', {
        connected,
        playerId,
        registered,
        boardLength: Array.isArray(board) ? board.length : null,
        playerCount: serverPlayers.length,
        minPlayers,
        started,
        winner,
        readySent,
        serverSaysReady: Boolean(me?.ready)
    });

    if (!connected || !playerId) {
        addLog('[DEBUG] Ready click blocked: connection/playerId missing.');
        console.warn('[BINGO][READY] Blocked: connection/playerId missing.');
        return;
    }

    if (!registered) {
        addLog('[DEBUG] Ready click blocked: server has not confirmed board registration.');
        console.warn(
            '[BINGO][READY] Blocked: registered=false. Inspect serverState/hasBoard logs.'
        );
        return;
    }

    if (started || winner || readySent || me?.ready) {
        addLog('[DEBUG] Ready click blocked: game started, winner exists, or already ready.');
        console.warn('[BINGO][READY] Blocked by game state.');
        return;
    }

    readySent = true;
    render();

    console.log('[BINGO][READY] Sending ready request to backend.');
    addLog('[DEBUG] Sending Ready request to server.');

    sendGame({ type: 'ready' });
});

$('newGameBtn').addEventListener('click', () => {
    if (!connected || newGamePending) return;

    newGamePending = true;
    $('error').textContent = '';
    render();

    sendGame({ type: 'newGame' });
    addLog('↻ New game requested.');
});

window.addEventListener('message', event => {
    const message = event.data;

    console.log('[BINGO][WEBVIEW] Message from extension host:', message);

    switch (message.command) {
        case 'init':
            $('playerName').value = message.savedName || '';
            $('serverUrl').value = message.serverUrl || '\${DEFAULT_SERVER_URL}';

            updateStatus(message.status || {
                icon: '🔴',
                text: 'Not connected',
                connected: false
            });
            break;

        case 'status':
            updateStatus(message.status);
            break;

        case 'connected':
            connected = true;
            $('error').textContent = '';
            $('game').style.display = 'block';
            updateSettingsVisibility();
            render();
            break;

        case 'welcome':
            playerId = message.playerId;
            displayName = message.displayName || displayName;
            board = Array.isArray(message.board) ? message.board : [];

            registered = false;
            readySent = false;
            newGamePending = false;

            $('game').style.display = 'block';
            $('error').textContent = '';

            render();
            addLog('Welcome, ' + displayName + '!');

            if (!message.replay) {
                console.log('[BINGO][BOARD] Registering initial board:', {
                    playerId,
                    boardLength: board.length,
                    board
                });

                addLog('[DEBUG] Sending initial board to server.');
                sendGame({ type: 'registerBoard', board: [...board] });
            } else {
                console.log('[BINGO][BOARD] Restored webview; not re-registering board.', {
                    playerId,
                    boardLength: board.length
                });
            }
            break;

        case 'serverMessage':
            if (message.payload?.type === 'serverState') {
                applyServerState(message.payload.state);
            }
            break;

        case 'error':
            console.error('[BINGO][ERROR]', message.message || message);

            $('error').textContent = message.message || 'An error occurred.';

            if (
                $('error').textContent.toLowerCase().includes('ready') ||
                $('error').textContent.toLowerCase().includes('board')
            ) {
                readySent = false;
            }

            addLog('⚠️ ' + $('error').textContent);
            render();
            break;

        case 'disconnected':
            connected = false;
            $('game').style.display = 'none';
            updateSettingsVisibility();
            break;

        case 'reset':
            resetClientState();
            break;
    }
});
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
        vscode.commands.registerCommand('bingo.open', () => {
            vscode.commands.executeCommand('workbench.view.explorer');
        })
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
