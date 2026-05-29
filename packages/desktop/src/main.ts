import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron';
import { join } from 'node:path';
import {
  createBuddyEnvelope,
  isBuddyEnvelope,
  type BuddyEnvelope,
  type DesktopCommandPayload,
  type LifecyclePayload,
} from '@cursor-buddy/protocol';

let mainWindow: BrowserWindow | undefined;
let stdinBuffer = '';

void app.whenReady().then(() => {
  createMainWindow();
  sendLifecycle('ready');
});

app.on('window-all-closed', () => {
  sendLifecycle('closing');
  app.quit();
});

ipcMain.on('buddy:command', (_event, payload: DesktopCommandPayload) => {
  writeEnvelope('desktop.command', payload);
});

ipcMain.on('buddy:notify-break', (_event, message: string) => {
  if (Notification.isSupported()) {
    new Notification({
      title: 'Cursor Buddy',
      body: message,
    }).show();
  }
});

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  stdinBuffer += chunk;

  let newlineIndex = stdinBuffer.indexOf('\n');
  while (newlineIndex >= 0) {
    const line = stdinBuffer.slice(0, newlineIndex).trim();
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    newlineIndex = stdinBuffer.indexOf('\n');

    if (line.length > 0) {
      handleExtensionLine(line);
    }
  }
});

function createMainWindow(): void {
  const display = screen.getPrimaryDisplay();
  const width = 336;
  const height = 438;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: display.workArea.x + display.workArea.width - width - 24,
    y: display.workArea.y + 80,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    transparent: true,
    skipTaskbar: false,
    title: 'Cursor Buddy',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createHtml())}`);
}

function handleExtensionLine(line: string): void {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isBuddyEnvelope(parsed)) {
      return;
    }

    mainWindow?.webContents.send('buddy:event', parsed);
  } catch (error) {
    writeEnvelope('lifecycle', {
      event: 'error',
      detail: error instanceof Error ? error.message : 'Failed to parse extension message.',
    });
  }
}

function sendLifecycle(event: LifecyclePayload['event'], detail?: string): void {
  writeEnvelope('lifecycle', { event, detail });
}

function writeEnvelope<TPayload>(type: BuddyEnvelope<TPayload>['type'], payload: TPayload): void {
  const envelope = createBuddyEnvelope('desktop-assistant', type, payload);
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

function createHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cursor Buddy</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, "Segoe UI", system-ui, sans-serif;
      --bg: rgba(16, 18, 27, 0.94);
      --panel: rgba(255, 255, 255, 0.08);
      --panel-strong: rgba(255, 255, 255, 0.14);
      --text: #f6f7fb;
      --muted: #a7adbd;
      --accent: #8ad7ff;
      --success: #83f0b2;
      --warn: #ffd166;
      --danger: #ff8c9a;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      overflow: hidden;
      background: transparent;
      color: var(--text);
    }

    .buddy {
      width: 100vw;
      height: 100vh;
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 22px;
      background:
        radial-gradient(circle at top left, rgba(76, 136, 255, 0.32), transparent 36%),
        radial-gradient(circle at bottom right, rgba(255, 120, 180, 0.2), transparent 32%),
        var(--bg);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
    }

    .drag-region {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
      -webkit-app-region: drag;
    }

    .title {
      min-width: 0;
    }

    .title strong {
      display: block;
      overflow: hidden;
      font-size: 15px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title span {
      color: var(--muted);
      font-size: 12px;
    }

    .window-actions {
      display: flex;
      gap: 6px;
      -webkit-app-region: no-drag;
    }

    button {
      border: 0;
      border-radius: 999px;
      background: var(--panel-strong);
      color: var(--text);
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      padding: 7px 10px;
    }

    button:hover {
      background: rgba(255, 255, 255, 0.22);
    }

    .hero {
      min-height: 132px;
      border-radius: 18px;
      padding: 16px;
      background: var(--panel);
    }

    .scenario {
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
      text-transform: uppercase;
    }

    .message {
      font-size: 16px;
      font-weight: 720;
      line-height: 1.35;
      margin-bottom: 12px;
    }

    .status-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .pill {
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      color: var(--muted);
      font-size: 12px;
      padding: 6px 9px;
    }

    .timer {
      display: grid;
      gap: 8px;
      margin: 14px 0;
    }

    .time {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }

    .time strong {
      font-size: 38px;
      letter-spacing: -0.05em;
    }

    .time span {
      color: var(--muted);
      font-size: 12px;
    }

    .progress {
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
    }

    .bar {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--success));
      transition: width 180ms ease;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }

    .stat {
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.08);
      padding: 10px;
    }

    .stat span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 4px;
    }

    .stat strong {
      font-size: 15px;
    }

    .files {
      height: 58px;
      overflow: hidden;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
      padding: 10px;
    }

    .actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .actions button {
      flex: 1;
    }
  </style>
</head>
<body>
  <main class="buddy" aria-label="Cursor Buddy">
    <section class="drag-region">
      <div class="title">
        <strong id="workspace">Cursor Buddy</strong>
        <span id="branch">等待 Cursor 连接</span>
      </div>
      <div class="window-actions">
        <button id="close" type="button" aria-label="关闭">关闭</button>
      </div>
    </section>

    <section class="hero" aria-live="polite">
      <div id="scenario" class="scenario">Loading</div>
      <div id="message" class="message">正在建立和 Cursor 的连接...</div>
      <div class="status-row">
        <span id="work-status" class="pill">未知状态</span>
        <span id="phase" class="pill">专注</span>
      </div>
    </section>

    <section class="timer">
      <div class="time">
        <strong id="time">25:00</strong>
        <span id="time-label">专注时间</span>
      </div>
      <div class="progress" aria-hidden="true">
        <div id="bar" class="bar"></div>
      </div>
    </section>

    <section class="stats" aria-label="工作状态">
      <div class="stat">
        <span>编辑</span>
        <strong id="edits">0</strong>
      </div>
      <div class="stat">
        <span>保存</span>
        <strong id="saves">0</strong>
      </div>
      <div class="stat">
        <span>空闲</span>
        <strong id="idle">0s</strong>
      </div>
    </section>

    <section id="files" class="files">还没有文件活动。</section>

    <section class="actions">
      <button id="toggle" type="button">暂停</button>
      <button id="break" type="button">休息</button>
      <button id="scenario-next" type="button">换场景</button>
    </section>
  </main>

  <script>
    const scenarios = [
      {
        id: 'comet',
        label: '彗星防御任务',
        working: '你的每一次编辑都在微调轨道计算，地球正在被你拉回安全区。',
        idle: '控制室安静了下来，彗星仍在逼近。下一次行动很关键。',
        break: '轨道已经暂时稳定，指挥中心要求你休息 5 分钟。'
      },
      {
        id: 'hero',
        label: '城市英雄行动',
        working: '城市因为你的专注重新亮起灯光，怪兽的脚步正在放慢。',
        idle: '怪兽停在街口，市民还在等待英雄的下一次行动。',
        break: '市民暂时安全，英雄也需要补充体力。'
      },
      {
        id: 'starship',
        label: '星舰跃迁校准',
        working: '跃迁引擎正在校准，你的工作让整艘船继续保持航向。',
        idle: '舰桥进入低功耗待命，星图还停在未完成的坐标上。',
        break: '跃迁窗口已经锁定，船员轮换休息开始。'
      }
    ];

    const state = {
      scenarioIndex: Math.floor(Math.random() * scenarios.length),
      settings: { focusMinutes: 25, breakMinutes: 5, autoStart: false },
      snapshot: null,
      phase: 'focus',
      running: true,
      phaseStartedAt: Date.now(),
      pausedAt: null,
      breakNotified: false
    };

    const el = {
      workspace: document.getElementById('workspace'),
      branch: document.getElementById('branch'),
      scenario: document.getElementById('scenario'),
      message: document.getElementById('message'),
      workStatus: document.getElementById('work-status'),
      phase: document.getElementById('phase'),
      time: document.getElementById('time'),
      timeLabel: document.getElementById('time-label'),
      bar: document.getElementById('bar'),
      edits: document.getElementById('edits'),
      saves: document.getElementById('saves'),
      idle: document.getElementById('idle'),
      files: document.getElementById('files'),
      toggle: document.getElementById('toggle'),
      break: document.getElementById('break'),
      scenarioNext: document.getElementById('scenario-next'),
      close: document.getElementById('close')
    };

    window.cursorBuddy.onEvent((envelope) => {
      if (envelope.type === 'cursor.settings') {
        state.settings = envelope.payload;
        resetPhase('focus');
      }

      if (envelope.type === 'cursor.snapshot') {
        state.snapshot = envelope.payload;
      }

      render();
    });

    el.toggle.addEventListener('click', () => {
      state.running = !state.running;
      if (state.running && state.pausedAt !== null) {
        state.phaseStartedAt += Date.now() - state.pausedAt;
        state.pausedAt = null;
      } else {
        state.pausedAt = Date.now();
      }
      render();
    });

    el.break.addEventListener('click', () => {
      resetPhase(state.phase === 'focus' ? 'break' : 'focus');
      render();
    });

    el.scenarioNext.addEventListener('click', () => {
      state.scenarioIndex = (state.scenarioIndex + 1) % scenarios.length;
      render();
    });

    el.close.addEventListener('click', () => {
      window.close();
    });

    setInterval(() => {
      if (state.running) {
        updateTimer();
      }
      render();
    }, 1000);

    render();

    function resetPhase(phase) {
      state.phase = phase;
      state.phaseStartedAt = Date.now();
      state.pausedAt = null;
      state.running = true;
      state.breakNotified = false;
    }

    function updateTimer() {
      const durationSeconds = getDurationSeconds();
      const elapsedSeconds = getElapsedSeconds();

      if (elapsedSeconds < durationSeconds) {
        return;
      }

      if (state.phase === 'focus') {
        const message = '专注时间完成了，休息 5 分钟再继续拯救世界。';
        resetPhase('break');
        window.cursorBuddy.notifyBreak(message);
      } else {
        resetPhase('focus');
      }
    }

    function getDurationSeconds() {
      const minutes = state.phase === 'focus'
        ? state.settings.focusMinutes
        : state.settings.breakMinutes;
      return Math.max(1, minutes) * 60;
    }

    function getElapsedSeconds() {
      const end = state.running ? Date.now() : state.pausedAt ?? Date.now();
      return Math.max(0, Math.floor((end - state.phaseStartedAt) / 1000));
    }

    function render() {
      const scenario = scenarios[state.scenarioIndex];
      const snapshot = state.snapshot;
      const active = snapshot !== null && snapshot.windowFocused && snapshot.idleSeconds <= 60;
      const durationSeconds = getDurationSeconds();
      const elapsedSeconds = Math.min(durationSeconds, getElapsedSeconds());
      const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);

      el.workspace.textContent = snapshot?.workspaceName ?? 'Cursor Buddy';
      el.branch.textContent = snapshot?.gitBranch ? '分支：' + snapshot.gitBranch : '等待 Cursor 活动';
      el.scenario.textContent = scenario.label;
      el.message.textContent = state.phase === 'break' ? scenario.break : active ? scenario.working : scenario.idle;
      el.workStatus.textContent = active ? '工作中：进度正在推进' : '等待行动：系统保持待命';
      el.workStatus.style.color = active ? 'var(--success)' : 'var(--warn)';
      el.phase.textContent = state.phase === 'focus' ? '专注阶段' : '休息阶段';
      el.time.textContent = formatTime(remainingSeconds);
      el.timeLabel.textContent = state.phase === 'focus' ? '专注时间' : '休息时间';
      el.bar.style.width = Math.round((elapsedSeconds / durationSeconds) * 100) + '%';
      el.edits.textContent = String(snapshot?.editsSinceStart ?? 0);
      el.saves.textContent = String(snapshot?.savesSinceStart ?? 0);
      el.idle.textContent = formatIdle(snapshot?.idleSeconds ?? 0);
      el.files.textContent = formatFiles(snapshot?.changedFiles ?? []);
      el.toggle.textContent = state.running ? '暂停' : '继续';
      el.break.textContent = state.phase === 'focus' ? '休息' : '回到专注';
    }

    function formatTime(totalSeconds) {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }

    function formatIdle(seconds) {
      if (seconds < 60) {
        return seconds + 's';
      }
      return Math.floor(seconds / 60) + 'm';
    }

    function formatFiles(files) {
      if (!files.length) {
        return '还没有文件活动。';
      }
      return files.slice(-3).join('\\n');
    }
  </script>
</body>
</html>`;
}
