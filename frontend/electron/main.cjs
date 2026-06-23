const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

let backendProcess = null;

ipcMain.handle("vault:choose-directory", async () => {
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const options = {
    title: "Select memory vault",
    properties: ["openDirectory", "createDirectory"],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] || null;
});

function devServerUrl() {
  return process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
}

function bundledBackendPath() {
  const executable = process.platform === "win32" ? "LuminaMindBackend.exe" : "LuminaMindBackend";
  return path.join(process.resourcesPath, "backend", executable);
}

function distIndexPath() {
  return path.join(__dirname, "..", "dist", "index.html");
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to reserve a backend port."));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function healthCheck(apiBaseUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (healthy) => {
      if (!settled) {
        settled = true;
        resolve(healthy);
      }
    };
    const request = http.get(`${apiBaseUrl}/api/health`, (response) => {
      response.resume();
      finish(response.statusCode === 200);
    });
    request.setTimeout(1000, () => {
      request.destroy();
      finish(false);
    });
    request.on("error", () => finish(false));
  });
}

async function waitForBackend(apiBaseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthCheck(apiBaseUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend did not become healthy at ${apiBaseUrl}.`);
}

async function startPackagedBackend() {
  const port = await reservePort();
  const apiBaseUrl = `http://127.0.0.1:${port}`;
  const backendPath = bundledBackendPath();
  backendProcess = spawn(
    backendPath,
    ["--host", "127.0.0.1", "--port", String(port), "--no-access-log"],
    {
      windowsHide: true,
      stdio: "ignore",
    },
  );
  backendProcess.once("exit", () => {
    backendProcess = null;
  });
  await waitForBackend(apiBaseUrl);
  process.env.LUMINA_API_BASE_URL = apiBaseUrl;
}

function stopPackagedBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "LuminaMind",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: `${__dirname}/preload.cjs`,
    },
  });

  if (app.isPackaged) {
    win.loadFile(distIndexPath());
  } else {
    win.loadURL(devServerUrl());
  }
}

app.whenReady().then(async () => {
  try {
    if (app.isPackaged) {
      await startPackagedBackend();
    }
    createWindow();
  } catch (error) {
    dialog.showErrorBox("LuminaMind startup failed", error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on("before-quit", stopPackagedBackend);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
