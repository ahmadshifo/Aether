const { getDefaultConfig } = require('expo/metro-config');
// Expo's default root/watchFolders are confined to this standalone app.
const config = getDefaultConfig(__dirname);
module.exports = config;
