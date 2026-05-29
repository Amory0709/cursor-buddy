import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import {
  createBuddyEnvelope,
  isBuddyEnvelope,
  isDesktopCommandPayload,
  type CursorActivityReason,
  type CursorActivitySnapshot,
  type DesktopCommandPayload,
  type FocusSessionSettings,
} from '@cursor-buddy/protocol';

const execFileAsync = promisify(execFile);
const SNAPSHOT_INTERVAL_MS = 5_000;
const ACTIVITY_DEBOUNCE_MS = 500;

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(rocket) Buddy';
  statusBar.tooltip = 'Open Cursor Buddy';
  statusBar.command = 'cursorBuddy.openAssistant';
  statusBar.show();

  let coordinator: CursorBuddyCoordinator | undefined;
  const tracker = new CursorActivityTracker((reason) => coordinator?.queueSnapshot(reason));
  const launcher = new DesktopAssistantLauncher(context);
  coordinator = new CursorBuddyCoordinator(tracker, launcher, statusBar);

  context.subscriptions.push(
    statusBar,
    tracker,
    launcher,
    coordinator,
    vscode.commands.registerCommand('cursorBuddy.openAssistant', () => coordinator.openAssistant()),
    vscode.commands.registerCommand('cursorBuddy.stopAssistant', () => coordinator.stopAssistant()),
    vscode.commands.registerCommand('cursorBuddy.sendSnapshot', () => coordinator.sendSnapshot('manual')),
  );

  if (readSettings().autoStart) {
    void coordinator.openAssistant();
  }
}

export function deactivate(): void {
  // Disposables registered in activate own shutdown.
}

class CursorBuddyCoordinator implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly snapshotTimer: NodeJS.Timeout;
  private pendingSnapshotTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly tracker: CursorActivityTracker,
    private readonly launcher: DesktopAssistantLauncher,
    private readonly statusBar: vscode.StatusBarItem,
  ) {
    this.snapshotTimer = setInterval(() => {
      void this.sendSnapshot('timer');
    }, SNAPSHOT_INTERVAL_MS);

    this.disposables.push(
      this.launcher.onCommand((command) => {
        void this.handleDesktopCommand(command);
      }),
    );
  }

  async openAssistant(): Promise<void> {
    await this.launcher.open();
    this.statusBar.text = '$(rocket) Buddy: on';
    await this.sendSettings();
    await this.sendSnapshot('manual');
  }

  stopAssistant(): void {
    this.launcher.stop();
    this.statusBar.text = '$(rocket) Buddy';
  }

  queueSnapshot(reason: CursorActivityReason): void {
    if (!this.launcher.isRunning) {
      return;
    }

    if (this.pendingSnapshotTimer !== undefined) {
      clearTimeout(this.pendingSnapshotTimer);
    }

    this.pendingSnapshotTimer = setTimeout(() => {
      this.pendingSnapshotTimer = undefined;
      void this.sendSnapshot(reason);
    }, ACTIVITY_DEBOUNCE_MS);
  }

  async sendSnapshot(reason: CursorActivityReason): Promise<void> {
    if (!this.launcher.isRunning) {
      return;
    }

    const snapshot = await this.tracker.createSnapshot(reason);
    this.launcher.send('cursor.snapshot', snapshot);
  }

  dispose(): void {
    clearInterval(this.snapshotTimer);

    if (this.pendingSnapshotTimer !== undefined) {
      clearTimeout(this.pendingSnapshotTimer);
    }

    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private async sendSettings(): Promise<void> {
    this.launcher.send('cursor.settings', readSettings());
  }

  private async handleDesktopCommand(payload: DesktopCommandPayload): Promise<void> {
    switch (payload.command) {
      case 'copyPrompt': {
        const prompt = typeof payload.data?.prompt === 'string' ? payload.data.prompt : '';
        await vscode.env.clipboard.writeText(prompt);
        void vscode.window.showInformationMessage('Cursor Buddy prompt copied to clipboard.');
        break;
      }
      case 'openWorkspace': {
        const workspacePath = this.tracker.workspacePath;
        if (workspacePath !== null) {
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), false);
        }
        break;
      }
      default:
        break;
    }
  }
}

class CursorActivityTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changedFiles = new Set<string>();
  private focused = vscode.window.state.focused;
  private lastActivityAt = Date.now();
  private editsSinceStart = 0;
  private savesSinceStart = 0;

  constructor(private readonly onActivity: (reason: CursorActivityReason) => void) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.touch('editor-change')),
      vscode.window.onDidChangeWindowState((state) => {
        this.focused = state.focused;
        this.touch('window-focus');
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme !== 'file') {
          return;
        }

        this.editsSinceStart += 1;
        this.changedFiles.add(this.toWorkspaceRelativePath(event.document.uri));
        this.touch('document-change');
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.scheme !== 'file') {
          return;
        }

        this.savesSinceStart += 1;
        this.changedFiles.add(this.toWorkspaceRelativePath(document.uri));
        this.touch('document-save');
      }),
    );
  }

  get workspacePath(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  }

  async createSnapshot(reason: CursorActivityReason): Promise<CursorActivitySnapshot> {
    const workspacePath = this.workspacePath;
    const activeFile = this.activeFilePath();

    return {
      workspaceName: this.workspaceName(workspacePath),
      workspacePath,
      activeFile,
      gitBranch: await readGitBranch(workspacePath),
      windowFocused: this.focused,
      lastActivityAt: this.lastActivityAt,
      idleSeconds: Math.max(0, Math.floor((Date.now() - this.lastActivityAt) / 1000)),
      editsSinceStart: this.editsSinceStart,
      savesSinceStart: this.savesSinceStart,
      changedFiles: [...this.changedFiles].slice(-20),
      reason,
    };
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private touch(reason: CursorActivityReason): void {
    this.lastActivityAt = Date.now();
    this.onActivity(reason);
  }

  private activeFilePath(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme !== 'file') {
      return null;
    }

    return this.toWorkspaceRelativePath(editor.document.uri);
  }

  private toWorkspaceRelativePath(uri: vscode.Uri): string {
    const workspacePath = this.workspacePath;
    if (workspacePath === null) {
      return uri.fsPath;
    }

    return relative(workspacePath, uri.fsPath);
  }

  private workspaceName(workspacePath: string | null): string {
    if (vscode.workspace.name !== undefined) {
      return vscode.workspace.name;
    }

    return workspacePath === null ? 'No workspace' : basename(workspacePath);
  }
}

class DesktopAssistantLauncher implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = '';
  private readonly commandEmitter = new vscode.EventEmitter<DesktopCommandPayload>();
  private readonly outputChannel = vscode.window.createOutputChannel('Cursor Buddy');

  constructor(private readonly context: vscode.ExtensionContext) {}

  get isRunning(): boolean {
    return this.process !== undefined && this.process.exitCode === null;
  }

  onCommand(listener: (payload: DesktopCommandPayload) => void): vscode.Disposable {
    return this.commandEmitter.event(listener);
  }

  async open(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const launchTarget = this.resolveLaunchTarget();
    if (launchTarget === null) {
      await vscode.window.showWarningMessage(
        'Cursor Buddy desktop app is not built yet. Run pnpm install and pnpm build in the cursor-buddy repo first.',
      );
      return;
    }

    this.outputChannel.appendLine(`Launching desktop assistant: ${launchTarget.command} ${launchTarget.args.join(' ')}`);

    this.process = spawn(launchTarget.command, launchTarget.args, {
      cwd: launchTarget.cwd,
      env: {
        ...process.env,
        CURSOR_BUDDY_EXTENSION_PATH: this.context.extensionPath,
      },
      windowsHide: false,
    });

    this.process.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    this.process.stderr.on('data', (chunk: Buffer) => {
      this.outputChannel.appendLine(`[desktop stderr] ${chunk.toString('utf8')}`);
    });
    this.process.on('error', (error) => {
      this.outputChannel.appendLine(`[desktop error] ${error.message}`);
      void vscode.window.showErrorMessage(`Cursor Buddy failed to start: ${error.message}`);
    });
    this.process.on('exit', (code, signal) => {
      this.outputChannel.appendLine(`Desktop assistant exited. code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.process = undefined;
      this.stdoutBuffer = '';
    });

    void vscode.window.showInformationMessage('Cursor Buddy desktop assistant started.');
  }

  stop(): void {
    this.process?.kill();
    this.process = undefined;
  }

  send<TPayload>(type: 'cursor.snapshot' | 'cursor.settings', payload: TPayload): void {
    if (!this.isRunning || this.process === undefined) {
      return;
    }

    const envelope = createBuddyEnvelope('cursor-extension', type, payload);
    this.process.stdin.write(`${JSON.stringify(envelope)}\n`);
  }

  dispose(): void {
    this.stop();
    this.commandEmitter.dispose();
    this.outputChannel.dispose();
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8');

    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = this.stdoutBuffer.indexOf('\n');

      if (line.length === 0) {
        continue;
      }

      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isBuddyEnvelope(parsed) || parsed.type !== 'desktop.command') {
        return;
      }

      if (isDesktopCommandPayload(parsed.payload)) {
        this.commandEmitter.fire(parsed.payload);
      }
    } catch (error) {
      console.error('[Cursor Buddy] Failed to parse desktop message.', error);
    }
  }

  private resolveLaunchTarget(): LaunchTarget | null {
    const config = vscode.workspace.getConfiguration('cursorBuddy');
    const command = config.get<string>('desktopCommand')?.trim();
    const args = config.get<string[]>('desktopArgs') ?? [];

    if (command !== undefined && command.length > 0) {
      return {
        command,
        args,
        cwd: dirname(command),
      };
    }

    const desktopRoot = resolve(this.context.extensionPath, '..', 'desktop');
    const electronBinary = process.platform === 'win32'
      ? join(desktopRoot, 'node_modules', '.bin', 'electron.cmd')
      : join(desktopRoot, 'node_modules', '.bin', 'electron');
    const mainEntry = join(desktopRoot, 'dist', 'main.js');

    if (!existsSync(electronBinary) || !existsSync(mainEntry)) {
      return null;
    }

    return {
      command: electronBinary,
      args: [mainEntry],
      cwd: desktopRoot,
    };
  }
}

interface LaunchTarget {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

function readSettings(): FocusSessionSettings {
  const config = vscode.workspace.getConfiguration('cursorBuddy');

  return {
    focusMinutes: config.get<number>('focusMinutes') ?? 25,
    breakMinutes: config.get<number>('breakMinutes') ?? 5,
    autoStart: config.get<boolean>('autoStart') ?? false,
  };
}

async function readGitBranch(workspacePath: string | null): Promise<string | null> {
  if (workspacePath === null) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: workspacePath,
      timeout: 2_000,
    });
    const branch = stdout.trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}
