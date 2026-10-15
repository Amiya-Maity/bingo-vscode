# 🎱 Multiplayer Bingo

A multiplayer Bingo game that runs directly inside the VS Code or Kiro Explorer sidebar. Connect with a friend, mark numbers on your board, and compete to complete five lines first!

## ✨ Features

- **Multiplayer gameplay** — Play with one friend using a shared server.
- **Random Bingo board** — Each player receives a shuffled board containing numbers 1–25.
- **Turn-based gameplay** — Only the player whose turn it is can select a number.
- **Live synchronization** — Game state and marked numbers are synchronized through Socket.IO.
- **Five-line victory** — Complete five lines to win Bingo.
- **Connection status** — Quickly identify whether the server is connecting, connected, or disconnected.
- **Collapsible connection settings** — Automatically collapse the settings after connecting.
- **Turn indicator** — See whose turn it is beside your board.
- **Ready system** — Both players must be ready before a game starts.
- **New Game** — Reset the game and prepare for another round.
- **Game Action Log** — Review game events, player readiness, selected numbers, and results.
- **Compact sidebar UI** — Play without leaving your coding environment.

## 🛠️ Tech Stack

- JavaScript
- Node.js
- Visual Studio Code Extension API
- Kiro IDE
- Socket.IO Client
- Socket.IO server for multiplayer communication
- HTML and CSS for the sidebar interface

## 📋 Prerequisites

- Node.js and npm
- VS Code or Kiro
- A running Bingo backend server
- The server passcode required to authenticate players

## 🚀 Installation

### 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_PROJECT_DIRECTORY>
```

Replace the placeholders with your repository URL and directory name.

### 2. Install dependencies

```bash
npm install
```

### 3. Run the extension locally

1. Open the project folder in VS Code or Kiro.
2. Press `F5` to launch the Extension Development Host, if your development environment supports it.
3. Open the Explorer sidebar.
4. Locate **Multiplayer Bingo**.
5. Enter the server URL and passcode.
6. Click **Connect**.

If your Kiro setup does not support launching an Extension Development Host with `F5`, package the extension and install the generated VSIX file instead.

## ⚙️ Configuration

The connection panel accepts the following settings:

| Setting | Description | Example |
|---|---|---|
| Server URL | Base URL of the Bingo backend | `https://hackend.in/bingob` |
| Passcode | Shared server authentication passcode | Your configured passcode |

The extension derives the Socket.IO path from the server URL.

For example:

```text
Server URL: https://hackend.in/bingob
Socket.IO path: /bingob/socket.io
```

Make sure your reverse proxy and backend are configured to serve Socket.IO at the expected path.

## 🎮 How to Play

1. **Connect:** Both players connect to the same Bingo server using the correct passcode.
2. **Get your board:** Each player receives a randomly shuffled board containing numbers 1–25.
3. **Wait for your friend:** The game waits until both players are connected and have registered their boards.
4. **Get ready:** Both players click **Ready**.
5. **Take turns:** The player whose turn is shown beside the board selects an unmarked number.
6. **Synchronize:** The server validates the move and broadcasts the updated game state.
7. **Win:** Complete five lines to win Bingo.
8. **Play again:** Use **New Game** to reset the round.

## 🧩 Game Rules

- Two players participate in a game.
- Each board contains the numbers 1–25 in a random order.
- Both players must be ready before gameplay starts.
- Players take turns selecting numbers.
- Moves are validated by the server.
- Marked numbers are synchronized between players.
- The first player to complete five lines wins.

The server should remain authoritative for turn validation, marked numbers, and winner detection.

## 🔌 Backend Protocol

The extension communicates with the backend using Socket.IO messages.

### Client-to-server messages

| Message type | Purpose |
|---|---|
| `registerBoard` | Register the player's board |
| `ready` | Indicate that the player is ready |
| `move` | Submit a selected number |
| `newGame` | Request a new round |

Example board registration:

```javascript
{
    type: 'registerBoard',
    board: [1, 7, 12, 18, 24 /* remaining numbers */]
}
```

The actual board sent by the extension contains all 25 unique numbers from 1 to 25.

Example move:

```javascript
{
    type: 'move',
    number: 12
}
```

### Server-to-client messages

| Message type | Purpose |
|---|---|
| `welcome` | Assign the player an ID |
| `serverState` | Broadcast the current game state |
| `error` | Report a server-side error |

Example welcome message:

```javascript
{
    type: 'welcome',
    playerId: 'player-id'
}
```

The `serverState` message should contain the game state, including the players, readiness, game status, current turn, winner, and marked numbers.

## 🔐 Security

- The extension sends the configured passcode through Socket.IO authentication.
- The backend should validate the passcode before allowing a connection.
- The backend should validate every move rather than trusting the client.
- Use HTTPS in production.
- Keep server credentials out of public repositories.
- Apply appropriate connection limits and input validation on the backend.

## 📦 Packaging the Extension

Install the dependencies and package the extension:

```bash
npm install
npm run package
```

If the packaging script is configured as shown in `package.json`, this creates a `.vsix` package in the project directory.

Install the package using the Extensions view or the IDE's supported VSIX installation workflow.

## 🐛 Troubleshooting

### Connect button does nothing

- Check the Extension Development Host or webview console for JavaScript errors.
- Verify that the `getFriend()` function and all its references use the same name.
- Confirm that the webview script initializes successfully.

### Connection fails

- Check the server URL and passcode.
- Confirm that the backend is running.
- Verify that the Socket.IO path matches the reverse proxy configuration.
- Check the backend logs for authentication or connection errors.

### A friend cannot join

- Confirm that both players use the same server and passcode.
- Ensure the server permits two simultaneous players.
- Check that both boards have been registered successfully.

### The game does not start

- Ensure both players are connected.
- Confirm that both players have registered their boards.
- Ensure both players click **Ready**.

### Game state does not synchronize

- Verify that the backend broadcasts `serverState` after relevant state changes.
- Confirm that the client and server use the same message names and payload structure.
- Check the server logs for rejected moves or other errors.

## 🗺️ Project Structure

```text
bingo-multiplayer/
├── extension.js       # Extension activation, webview, and game client
├── package.json       # Extension metadata, commands, view, dependencies
├── package-lock.json  # Dependency lockfile
└── README.md          # Project documentation
```

The backend is maintained separately unless you have included it in this repository.

## 📄 License

Add your preferred license here, such as the MIT License, if applicable.
