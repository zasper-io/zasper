require('dotenv').config();
const fs = require('fs');
const { notarize: electronNotarize } = require('@electron/notarize');

const notarizeApp = async (context) => {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appId = 'io.zasper.app';
  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  if (!fs.existsSync(appPath)) {
    console.error(`Application not found at: ${appPath}`);
    return;
  }

  console.log(
    `Notarizing app with ID ${appId} located at ${appPath} using Apple ID ${process.env.APPLE_ID}`
  );

  try {
    await electronNotarize({
      appBundleId: appId,
      appPath: appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      ascProvider: '', // If applicable, add ASC provider here
    });
  } catch (error) {
    console.error('Notarization Failed:', error);
  }

  console.log(`Notarization complete for ${appId}`);
};

module.exports = notarizeApp;
