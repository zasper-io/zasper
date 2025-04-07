const { app, ipcMain, BrowserWindow, protocol, dialog } = require("electron");
const path = require("path");
const url = require("url");
const os = require("os");
const { execFile } = require("child_process");
const http = require("http");

var log = require("electron-log");

const apiPort = 8048;
var apiProcess;
var mainWindow;
var welcomeScreen;
var welcomeScreenOn = false;

const feedURL = 'https://update.electronjs.org/zasper-io/zasper';

// Optional, initialize the logger for any renderer process
log.transports.file.level = "silly";

const isApiServerReady = (port, callback) => {
  const options = {
    hostname: "localhost",
    port: port,
    path: "/api/health",
    method: "GET",
  };

  const req = http.request(options, (res) => {
    callback(res.statusCode === 200);
  });

  req.on("error", () => {
    callback(false);
  });

  req.end();
};

const startApiServer = (directory) => {
  apiProcess = execFile(path.join(__dirname, "zasper"), { cwd: directory });

  apiProcess.stdout.on("data", (data) => {
    log.info(`API Server: ${data}`);
  });

  apiProcess.stderr.on("data", (data) => {
    log.info(`API Server Error: ${data}`);
  });

  apiProcess.on("close", (code) => {
    log.info(`API Server exited with code ${code}`);
  });
};

const startApp = () => {
  welcomeScreen = new BrowserWindow({
    width: 1050,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  welcomeScreen.loadFile(path.join(__dirname, "welcome.html"));
  if (!app.isPackaged) {
    welcomeScreen.webContents.openDevTools();
  }
  welcomeScreen.center();
  welcomeScreenOn = true;
};

// Create the native browser window.
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1350,
    height: 900,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const appURL = app.isPackaged
    ? "http://localhost:8048"
    : "http://localhost:3000";
  mainWindow.loadURL(appURL);

  // Automatically open Chrome's DevTools in development mode.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

// This method will be called when Electron has finished its initialization and
// is ready to create the browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  startApp();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      startApp();
      log.info("Window created!");
    }
  });

   // Check for updates as soon as the app is ready
  autoUpdater.setFeedURL(feedURL); // Set the URL where the updates will be downloaded from

  // Automatically check for updates when the app is ready
  autoUpdater.checkForUpdatesAndNotify();

  // Handle the event when an update is downloaded
  autoUpdater.on('update-downloaded', (info) => {
    dialog
      .showMessageBox({
        type: 'info',
        buttons: ['Restart', 'Later'],
        title: 'Update Available',
        message: 'A new version has been downloaded. Restart the application to apply the update.',
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  // Handle update errors
  autoUpdater.on('error', (error) => {
    console.error('Error occurred while updating:', error);
  });

  // Optional: Show update progress
  autoUpdater.on('download-progress', (progressObj) => {
    console.log('Update progress:', progressObj);
  });
});

ipcMain.handle("dialog:openDirectory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  return result.filePaths;
});

ipcMain.handle("runCommand", async (event, directory) => {
  if (apiProcess) {
    apiProcess.kill();
    mainWindow.close();
  }
  startApiServer(directory)

  const checkApi = () => {
    isApiServerReady(apiPort, (isReady) => {
      if (isReady) {
        if (welcomeScreenOn && welcomeScreen) {
          welcomeScreenOn = false
          welcomeScreen.close();
        }
        createWindow();
      } else {
        setTimeout(checkApi, 1000);
      }
    });
  };

  checkApi();
});

async function getLatestReleaseVersion() {
  try {
      const response = await fetch('https://api.github.com/repos/zasper-io/zasper/releases/latest');
      const data = await response.json();

      if (data && data.tag_name) {
      // Update the version in the HTML
      document.getElementById('version').innerText = data.tag_name;
      } else {
      console.error('Version not found in response');
      }
  } catch (error) {
      console.error('Error fetching the latest release:', error);
  }
}

function getCurrentVersion() {
  return app.getVersion();
}

ipcMain.handle('renderer:currentVersion', () => {
  return getCurrentVersion();
});

ipcMain.handle('renderer:getLatestReleaseVersion', () => {
  return getLatestReleaseVersion();
});


app.on("before-quit", () => {
  if (apiProcess) {
    apiProcess.kill(); // Ensure the API server is killed
  }
});

// Quit when all windows are closed, except on macOS.
// There, it's common for applications and their menu bar to stay active until
// the user quits  explicitly with Cmd + Q.
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// If your app has no need to navigate or only needs to navigate to known pages,
// it is a good idea to limit navigation outright to that known scope,
// disallowing any other kinds of navigation.
const allowedNavigationDestinations = "https://my-app.com";
app.on("web-contents-created", (event, contents) => {
  contents.on("will-navigate", (event, navigationURL) => {
    const parsedURL = new URL(navigationURL);
    if (!allowedNavigationDestinations.includes(parsedURL.origin)) {
      event.preventDefault();
    }
  });
});
