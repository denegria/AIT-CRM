import { registerHooks } from 'node:module';
import fs from 'node:fs';
import { transformSync } from 'esbuild';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/auth') {
      return {
        shortCircuit: true,
        url: new URL('../src/lib/auth.js', import.meta.url).href,
      };
    }
    if (specifier.endsWith('.css')) {
      return {
        shortCircuit: true,
        url: new URL(specifier, context.parentURL).href,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export default new Proxy({}, { get: (_target, key) => String(key) });',
      };
    }
    if (url.startsWith('file:') && url.includes('/src/') && url.endsWith('.js')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: transformSync(fs.readFileSync(new URL(url), 'utf8'), {
          format: 'esm',
          jsx: 'automatic',
          loader: 'jsx',
          sourcefile: new URL(url).pathname,
          sourcemap: 'inline',
          target: 'node20',
        }).code,
      };
    }
    return nextLoad(url, context);
  },
});
