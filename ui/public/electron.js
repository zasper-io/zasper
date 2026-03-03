const { app, ipcMain, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { execFile } = require("child_process");
const http = require("http");

var log = require("electron-log");

const apiPort = 8048;
var apiProcess;
var mainWindow;
var welcomeScreen;
var welcomeScreenOn = false;

// Optional, initialize the logger for any renderer process
log.transports.file.level = "silly";
log.transports.console.level = "silly";

function getGoBinaryName() {
  const platform = process.platform; // 'darwin', 'win32', 'linux'
  const arch = process.arch;         // 'arm64', 'x64', 'ia32'

  let goos;
  let goarch;

  // Map Node.js platform to Go OS names
  if (platform === 'darwin') {
    goos = 'darwin';
  } else if (platform === 'linux') {
    goos = 'linux';
  } else if (platform === 'win32') {
    goos = 'windows';
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  // Map Node.js architecture to Go arch names
  if (arch === 'x64') {
    goarch = 'amd64';
  } else if (arch === 'arm64') {
    goarch = 'arm64';
  } else if (arch === 'ia32') {
    goarch = '386';
  } else {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  // Append `.exe` only for Windows
  const ext = goos === 'windows' ? '.exe' : '';

  // Return final filename
  return `${goos}-${goarch}/zasper${ext}`;
}

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
  const binaryName = getGoBinaryName();
  const binaryPath = path.join(process.resourcesPath, 'backend', binaryName);
  log.info("Go Binary Path:", binaryPath);
  apiProcess = execFile(binaryPath, { cwd: directory });

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

  log.info('About to load file:', path.join(__dirname, "welcome.html"));
  welcomeScreen.loadFile(path.join(__dirname, "welcome.html"));
  log.info('File loaded');
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
});

ipcMain.handle("dialog:openDirectory", async () => {
  log.info("open dialog!");
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  return result.filePaths;
});

ipcMain.handle("runCommand", async (event, directory) => {
  log.info("run command to open directory =>", directory);
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
