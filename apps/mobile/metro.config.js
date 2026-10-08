// Монорепозиторий: Metro должен видеть общие пакеты (@hypothec/core, @hypothec/api-contract) — они в TypeScript-исходниках.
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const packagesDir = path.join(workspaceRoot, 'packages');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')];

// Пакеты ядра импортируют свои модули как './money/money.js' (так требует ESM в TypeScript),
// а на диске лежит money.ts. Для файлов из packages/ подменяем .js на .ts.
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js') && context.originModulePath.startsWith(packagesDir)) {
    const candidate = path.resolve(path.dirname(context.originModulePath), moduleName.replace(/\.js$/, '.ts'));
    if (fs.existsSync(candidate)) return { type: 'sourceFile', filePath: candidate };
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
