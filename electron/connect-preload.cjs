const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("battlestation", {
  connect: (payload) => ipcRenderer.invoke("connect:save", payload),
  useLocal: () => ipcRenderer.invoke("connect:local"),
  current: () => ipcRenderer.invoke("connect:get"),
});
