// Metro for the app: Expo's defaults (which already watch the monorepo's packages and node_modules), plus the one
// folder outside them the app reads, WS-DS's font cuts in assets/fonts/native. The web export loads those files at
// runtime (src/_shims/font-sources.web.ts); native builds embed them through the expo-font plugin (app.config.ts).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../../assets/fonts/native")];

// Shared packages publish TypeScript sources with NodeNext's .js import spelling. Metro does not
// substitute .ts for that spelling. Keep real JS resolutions first; only retry relative imports from
// workspace TS sources, letting Metro retain its platform-specific source extension order.
const packagesRoot = `${path.resolve(__dirname, "../../packages")}${path.sep}`;
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (
      context.originModulePath.startsWith(packagesRoot) &&
      /\.tsx?$/.test(context.originModulePath) &&
      moduleName.startsWith(".") &&
      moduleName.endsWith(".js")
    ) {
      return resolve(context, moduleName.slice(0, -3), platform);
    }
    throw error;
  }
};

module.exports = config;
