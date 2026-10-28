// Metro for the app: Expo's defaults (which already watch the monorepo's packages and node_modules), plus the one
// folder outside them the app reads, WS-DS's font cuts in assets/fonts/native. The web export loads those files at
// runtime (src/_shims/font-sources.web.ts); native builds embed them through the expo-font plugin (app.config.ts).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../../assets/fonts/native")];

module.exports = config;
