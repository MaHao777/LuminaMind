const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("luminaDesktop", {
  chooseVaultDirectory: () => ipcRenderer.invoke("vault:choose-directory"),
});
