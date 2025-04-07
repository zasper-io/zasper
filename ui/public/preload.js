// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension


const { contextBridge, ipcRenderer } = require('electron');

// As an example, here we use the exposeInMainWorld API to expose the browsers
// and node versions to the main window.
// They'll be accessible at "window.versions".
process.once('loaded', () => {
  contextBridge.exposeInMainWorld('api', {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    runCommand: (directory) => ipcRenderer.invoke('runCommand', directory),
    getVersion: () => ipcRenderer.invoke('renderer:currentVersion'),
    getLatestReleaseVersion: () => ipcRenderer.invoke('renderer:getLatestReleaseVersion'),
  });
})
