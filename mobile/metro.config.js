import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { getDefaultConfig } from 'expo/metro-config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('db')) {
  config.resolver.assetExts.push('db');
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('node:')) {
    return { type: 'empty' };
  }
  if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
    const extMatch = moduleName.match(/\.(js|jsx|mjs|cjs)$/);
    if (extMatch) {
      const ext = extMatch[1];
      const basePath = moduleName.slice(0, -(ext.length + 1));
      const currentDir = context.originModulePath
        ? path.dirname(context.originModulePath)
        : __dirname;
      const possibleExtensions = ['.tsx', '.ts', '.jsx', '.js'];
      
      for (const targetExt of possibleExtensions) {
        const candidate = path.resolve(currentDir, basePath + targetExt);
        if (fs.existsSync(candidate)) {
          return context.resolveRequest(context, basePath + targetExt, platform);
        }
      }

      for (const targetExt of possibleExtensions) {
        const candidateIndex = path.resolve(currentDir, basePath, 'index' + targetExt);
        if (fs.existsSync(candidateIndex)) {
          return context.resolveRequest(context, basePath + '/index' + targetExt, platform);
        }
      }
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

export default config;
