const { app, ipcMain, BrowserWindow, protocol, dialog } = require('electron')
const path = require('path')
const url = require('url')
const os = require('os');
const { exec, execFile } = require('child_process')

var log  = require('electron-log')

// Optional, initialize the logger for any renderer process
log.transports.file.level = 'silly'


// Create the native browser window.
function createWindow () {
  execFile(path.join(__dirname, 'zasper'), { cwd: os.homedir() }, (error, stdout, stderr) => {
    if (error) {
      log.error(`Error starting gobackend: ${error.message}`)
      return
    }
    if (stderr) {
      log.error(`stderr: ${stderr}`)
      return
    }
    log.info(`stdout: ${stdout}`)
  })

  const mainWindow = new BrowserWindow({
    width: 1350,
    height: 900,
    show: false,
    // Set the path of an additional "preload" script that can be used to
    // communicate between the node-land and the browser-land.

    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    },
  })

  // and load the index.html of the app.
  var loaderScreen = new BrowserWindow({ 
    width: 700, 
    height: 400, 
    transparent: true, 
    frame: false, 
    alwaysOnTop: true 
  });
  
  loaderScreen.loadFile(path.join(__dirname, 'loadscreen.html'));
  loaderScreen.center();
  setTimeout(function () {
    loaderScreen.close();
    mainWindow.center();
    mainWindow.show();
  }, 5000);

  const appURL = app.isPackaged
    ? url.format({
      pathname: path.join(__dirname, 'index.html'),
      protocol: 'file:',
      slashes: true
    })
    : 'http://localhost:3000'
  mainWindow.loadURL(appURL)

  // Automatically open Chrome's DevTools in development mode.
  if (!app.isPackaged) {
    // loaderScreen.webContents.openDevTools()
    mainWindow.webContents.openDevTools()
  }
}



// This method will be called when Electron has finished its initialization and
// is ready to create the browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      log.info("Window created!")
    }

    
  })

  createWindow()
})

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.filePaths;
});

ipcMain.handle('runCommand', async (event, directory) => {
  // Note : windows may vary
  const command = `${path.join(__dirname, 'zasper')} --cwd "${directory}"`;

  execFile(command, { cwd: directory }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${stderr}`);
      return;
    }
    console.log(`Output: ${stdout}`);
  });
});

// Quit when all windows are closed, except on macOS.
// There, it's common for applications and their menu bar to stay active until
// the user quits  explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// If your app has no need to navigate or only needs to navigate to known pages,
// it is a good idea to limit navigation outright to that known scope,
// disallowing any other kinds of navigation.
const allowedNavigationDestinations = 'https://my-app.com'
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationURL) => {
    const parsedURL = new URL(navigationURL)
    if (!allowedNavigationDestinations.includes(parsedURL.origin)) {
      event.preventDefault()
    }
  })
})
