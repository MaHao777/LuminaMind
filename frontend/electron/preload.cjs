const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("luminaDesktop", {
  chooseVaultDirectory: () => ipcRenderer.invoke("vault:choose-directory"),
  getApiBaseUrl: () => process.env.LUMINA_API_BASE_URL || null,
  setTitlebarTheme: (theme) => ipcRenderer.invoke("titlebar:set-theme", theme),
});
