const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseVersion, FuseV1Options } = require("@electron/fuses");
module.exports = {
  packagerConfig: {
    name: "Common",
    executableName: "common",
    appBundleId: "com.common.suite",
    asar: true,
    prune: false,
    ignore: (path) => !!path && !/^\/(dist|package\.json)(\/|$)/.test(path),
    ...(process.env.APPLE_SIGN_IDENTITY
      ? { osxSign: { identity: process.env.APPLE_SIGN_IDENTITY } }
      : {}),
    ...(process.env.APPLE_API_KEY
      ? {
          osxNotarize: {
            appleApiKey: process.env.APPLE_API_KEY,
            appleApiKeyId: process.env.APPLE_API_KEY_ID,
            appleApiIssuer: process.env.APPLE_API_ISSUER,
          },
        }
      : {}),
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "common_suite",
        authors: "Common",
        description: "Modular business workspace",
        ...(process.env.WINDOWS_CERT_FILE
          ? {
              certificateFile: process.env.WINDOWS_CERT_FILE,
              certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
            }
          : {}),
      },
    },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] },
    { name: "@electron-forge/maker-dmg", config: {} },
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: { maintainer: "Common" },
      },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
