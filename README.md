# Cursor Buddy MVP

Cursor Buddy is a small proof of concept for a Cursor companion that tracks workspace activity, runs focus/break sessions, and shows a lightweight narrative status in an external always-on-top desktop window.

## Architecture

- `packages/protocol` owns the JSON message contract shared by every process.
- `packages/extension` is the Cursor/VS Code extension. It observes workspace activity and launches the desktop helper.
- `packages/desktop` is the Electron companion window. It owns UI, focus timer state, and reminders.

The first transport is JSON Lines over child-process stdio:

```text
Cursor Extension -- JSON envelope over stdio --> Desktop Buddy
Desktop Buddy   -- JSON envelope over stdio --> Cursor Extension
```

This keeps the extension and desktop UI loosely coupled. The transport can later be replaced with a loopback HTTP server, WebSocket, named pipe, or MCP tool without changing the activity and timer payloads.

## MVP Behavior

- Status bar entry: `Buddy`.
- Commands:
  - `Cursor Buddy: Open Assistant`
  - `Cursor Buddy: Stop Assistant`
  - `Cursor Buddy: Send Activity Snapshot`
- Activity signals:
  - active editor changes
  - text document edits
  - document saves
  - Cursor window focus changes
- Desktop UI:
  - always-on-top compact window
  - 25-minute focus and 5-minute break defaults
  - working/idle state based on recent Cursor activity
  - random narrative scenarios
  - break reminder when focus time expires

## Development

```powershell
cd tools/cursor-buddy
pnpm install
pnpm build
```

Then run/debug `packages/extension` as a VS Code extension. The extension expects the desktop package to be built and to have Electron installed.

For local development the default desktop command is resolved from:

```text
packages/desktop/node_modules/.bin/electron(.cmd)
packages/desktop/dist/main.js
```

You can override it with:

```json
{
  "cursorBuddy.desktopCommand": "C:\\path\\to\\electron.cmd",
  "cursorBuddy.desktopArgs": ["C:\\path\\to\\tools\\cursor-buddy\\packages\\desktop\\dist\\main.js"]
}
```
