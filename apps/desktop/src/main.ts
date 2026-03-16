import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell, ipcMain } from 'electron';
import { ChildProcess, fork } from 'child_process';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

const isDev = !app.isPackaged;
const SERVER_PORT = Number(process.env.PORT ?? 4070);
const WEB_PORT = 4080;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let webProcess: ChildProcess | null = null;
let splashWindow: BrowserWindow | null = null;

// ─── Server Management ────────────────────────────────

function getServerPath(): string {
  if (isDev) {
    return resolve(__dirname, '..', '..', 'server', 'dist', 'index.js');
  }
  return join(process.resourcesPath, 'server-pack', 'index.cjs');
}

function getWebPath(): string {
  if (isDev) {
    return ''; // Not used in dev — Next.js dev server runs separately
  }
  return join(process.resourcesPath, 'web', 'server.js');
}

async function startServer(): Promise<void> {
  const serverPath = getServerPath();

  if (!existsSync(serverPath)) {
    console.error('[Desktop] Server not found at:', serverPath);
    dialog.showErrorBox(
      'HiveClaw',
      `Server not found at: ${serverPath}\n\nPlease rebuild the server.`
    );
    app.quit();
    return;
  }

  return new Promise((resolvePromise, reject) => {
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        SUPERCLAW_PORT: String(SERVER_PORT),
        NODE_ENV: 'production',
        SUPERCLAW_WEB_DIR: isDev ? '' : join(process.resourcesPath, 'server-pack', 'web'),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log('[Server]', msg.trim());
      if (msg.includes('HiveClaw Server') || msg.includes('Server listening')) {
        resolvePromise();
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Server Error]', data.toString().trim());
    });

    serverProcess.on('exit', (code) => {
      console.log('[Server] Exited with code:', code);
      serverProcess = null;
    });

    serverProcess.on('error', (err) => {
      console.error('[Server] Failed to start:', err);
      reject(err);
    });

    setTimeout(() => resolvePromise(), 10000);
  });
}

async function startWeb(): Promise<void> {
  if (isDev) return; // Dev mode uses next dev externally

  const webPath = getWebPath();
  if (!existsSync(webPath)) {
    console.warn('[Desktop] Web standalone not found at:', webPath);
    // Fallback: point browser directly at server
    return;
  }

  return new Promise((resolvePromise) => {
    webProcess = fork(webPath, [], {
      env: {
        ...process.env,
        PORT: String(WEB_PORT),
        HOSTNAME: 'localhost',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    webProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log('[Web]', msg.trim());
      if (msg.includes('Ready') || msg.includes('started')) {
        resolvePromise();
      }
    });

    webProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[Web Error]', data.toString().trim());
    });

    webProcess.on('exit', (code) => {
      console.log('[Web] Exited with code:', code);
      webProcess = null;
    });

    setTimeout(() => resolvePromise(), 8000);
  });
}

function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
  if (webProcess) {
    webProcess.kill('SIGTERM');
    webProcess = null;
  }
}

// ─── Splash Screen ────────────────────────────────────

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splash.loadURL(`data:text/html,
    <html>
    <body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0D1117;color:#E6EDF3;font-family:Inter,system-ui;border-radius:16px;overflow:hidden;user-select:none;-webkit-app-region:drag">
      <div style="text-align:center">
        <div style="font-size:80px;margin-bottom:16px">&#x1F980;</div>
        <div style="font-size:20px;font-weight:700;margin-bottom:8px">HiveClaw</div>
        <div style="font-size:13px;color:#8B949E">Starting engine...</div>
        <div style="margin-top:20px;width:200px;height:3px;background:#30363D;border-radius:2px;overflow:hidden;margin-left:auto;margin-right:auto">
          <div style="width:40%;height:100%;background:#FF6B6B;border-radius:2px;animation:loading 1.5s ease-in-out infinite"></div>
        </div>
      </div>
      <style>
        @keyframes loading {
          0%   { width:10%; margin-left:0 }
          50%  { width:60%; margin-left:20% }
          100% { width:10%; margin-left:90% }
        }
      </style>
    </body>
    </html>
  `);

  return splash;
}

// ─── Main Window ──────────────────────────────────────

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'HiveClaw',
    titleBarStyle: 'hiddenInset', // macOS native traffic lights
    trafficLightPosition: { x: 16, y: 40 },
    backgroundColor: '#0D1117',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // Dev → Next.js dev server on 4080; Prod → Fastify serves everything on 4070
  const webUrl = isDev
    ? `http://localhost:${WEB_PORT}`
    : `http://localhost:${SERVER_PORT}`;

  mainWindow.loadURL(webUrl);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.on('close', (e) => {
    // macOS: hide to tray instead of quitting
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in the system browser, not inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── Tray ─────────────────────────────────────────────

function createTray(): void {
  // Empty nativeImage → text-only tray (cross-platform fallback)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('HiveClaw');
  tray.setTitle('🦀'); // macOS menu bar text

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show HiveClaw',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'New Chat',
      accelerator: 'CmdOrCtrl+N',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        mainWindow?.webContents.executeJavaScript(
          'document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true }))'
        );
      },
    },
    { type: 'separator' },
    {
      label: `Server: localhost:${SERVER_PORT}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit HiveClaw',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        stopServer();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

// ─── App Menu ─────────────────────────────────────────

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'HiveClaw',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow?.webContents.executeJavaScript(
              'document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", metaKey: true }))'
            );
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            stopServer();
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'HiveClaw Documentation',
          click: () => shell.openExternal('https://github.com/danilocaffaro/hiveclaw'),
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/danilocaffaro/hiveclaw/issues'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── App Lifecycle ────────────────────────────────────

app.whenReady().then(async () => {
  // Show splash immediately
  splashWindow = createSplash();

  // Boot the backend + web
  await startServer();
  await startWeb();

  // Build the chrome
  createMenu();
  createTray();
  createMainWindow();
});

app.on('window-all-closed', () => {
  // On non-macOS platforms, quit when all windows are closed
  if (process.platform !== 'darwin') {
    stopServer();
    app.quit();
  }
});

app.on('activate', () => {
  // macOS dock click — restore or recreate the window
  if (mainWindow) {
    mainWindow.show();
  } else {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  stopServer();
});

// ─── Deep Links ───────────────────────────────────────

app.setAsDefaultProtocolClient('hiveclaw');

app.on('open-url', (_event, url) => {
  // e.g. hiveclaw://session/abc123
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    const path = url.replace('hiveclaw://', '/');
    mainWindow.webContents.executeJavaScript(
      `window.location.hash = '${path}'`
    );
  }
});
