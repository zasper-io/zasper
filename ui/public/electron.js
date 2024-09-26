const { app, ipcMain, BrowserWindow, protocol, dialog } = require('electron')
const path = require('path')
const url = require('url')
const os = require('os');
const { exec, execFile } = require('child_process')
const http = require('http');

var log  = require('electron-log')

// Optional, initialize the logger for any renderer process
log.transports.file.level = 'silly'

const isApiServerReady = (port, callback) => {
  const options = {
      hostname: 'localhost',
      port: port,
      path: '/api/health', // Modify to your actual health check endpoint
      method: 'GET',
  };

  const req = http.request(options, (res) => {
    // callback(res.statusCode === 200);
    callback(true);
  });

  req.on('error', () => {
      callback(false);
  });

  req.end();
};

const startApiServer = () => {
  const apiProcess =  execFile(path.join(__dirname, 'zasper'), { cwd: os.homedir() });

  apiProcess.stdout.on('data', (data) => {
      console.log(`API Server: ${data}`);
  });

  apiProcess.stderr.on('data', (data) => {
      console.error(`API Server Error: ${data}`);
  });

  apiProcess.on('close', (code) => {
      console.log(`API Server exited with code ${code}`);
  });

  return apiProcess;
};


const startApp = () => {
  const apiPort = 8888; // Replace with your actual API port
  const apiProcess = startApiServer();

  var loaderScreen = new BrowserWindow({ 
    width: 700, 
    height: 400, 
    transparent: true, 
    frame: false, 
    alwaysOnTop: true 
  });
  
  loaderScreen.loadFile(path.join(__dirname, 'loadscreen.html'));
  loaderScreen.center();

  const checkApi = () => {
      isApiServerReady(apiPort, (isReady) => {
          if (isReady) {
            loaderScreen.close();
            createWindow();
          } else {
            setTimeout(checkApi, 1000);
          }
      });
  };

  checkApi();
}



// Create the native browser window.
function createWindow () {

  const mainWindow = new BrowserWindow({
    width: 1350,
    height: 900,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    },
  })
 
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
      startApp()
      log.info("Window created!")
    }

    
  })

  startApp()
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
