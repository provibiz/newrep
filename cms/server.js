const fs = require('fs');
const tsUtils = require('@strapi/typescript-utils');
const { createStrapi } = require('@strapi/strapi');

(async () => {
  const appDir = __dirname;
  const isTSProject = await tsUtils.isUsingTypeScript(appDir);
  const outDir = await tsUtils.resolveOutDir(appDir);
  const distDir = isTSProject ? outDir : appDir;

  if (isTSProject && !fs.existsSync(outDir)) {
    throw new Error(`${outDir} directory not found. Please run the build command before starting your application`);
  }

  await createStrapi({ appDir, distDir }).start();
})();
