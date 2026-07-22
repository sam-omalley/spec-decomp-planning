/**
 * Test environment for component tests (#136), preloaded via `node
 * --import` before any test file runs (see the `test` script in
 * package.json):
 *
 * 1. A `.tsx` load hook, so test files can import the app's real
 *    components. Node's `--experimental-strip-types` strips TypeScript
 *    syntax from `.ts` files but doesn't recognize `.tsx` at all — JSX
 *    isn't erasable syntax — so this fills exactly that gap using esbuild
 *    (already a transitive Vite dependency) to transform `.tsx` to plain
 *    JS on the fly, matching the project's tsconfig.json ("jsx":
 *    "react-jsx", the automatic runtime). Plain `.ts` files are untouched
 *    here — Node's native stripping still handles those. Test files
 *    themselves still can't use JSX syntax directly, so they build
 *    elements with `React.createElement` instead (consistent with the
 *    project's `erasableSyntaxOnly` convention).
 * 2. A jsdom environment, so `@testing-library/react` has a DOM to render
 *    into.
 *
 * `esbuild`/`jsdom` are dynamically imported and the whole thing is a
 * no-op if they're missing, so the domain suite still runs with no
 * `npm install` (this file is preloaded for *every* test file — a domain
 * test never needs a DOM or a `.tsx` import, and shouldn't have to pay
 * for either). `npm install` is only actually required to add or run a
 * component test. This file only sets up the environment; it renders
 * nothing itself.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

try {
  const { transformSync } = await import('esbuild');
  // Dynamic, not a static `import { registerHooks } from 'node:module'` —
  // registerHooks only exists on Node 22.15+, and a static import of a
  // missing named export throws at module-load time, outside this
  // try/catch. Dynamic-importing the whole module keeps the "missing
  // component-test tooling degrades to a no-op" property intact on older
  // Node too, not just when esbuild/jsdom aren't installed.
  const { registerHooks } = await import('node:module');

  registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith('.tsx')) return nextLoad(url, context);
      const path = fileURLToPath(url);
      const { code } = transformSync(readFileSync(path, 'utf8'), {
        loader: 'tsx',
        format: 'esm',
        target: 'esnext',
        jsx: 'automatic',
        sourcefile: path,
      });
      return { format: 'module', source: code, shortCircuit: true };
    },
  });

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Copies every property (enumerable or not) jsdom's Window has that
  // Node's global object doesn't already define (matches jsdom's own
  // documented recipe for wiring itself into a non-browser test runner).
  const copyProps = (src: object, target: object): void => {
    const props = Object.getOwnPropertyNames(src).filter((prop) => !(prop in target));
    for (const prop of props) {
      const descriptor = Object.getOwnPropertyDescriptor(src, prop);
      if (descriptor) Object.defineProperty(target, prop, descriptor);
    }
  };

  // Node itself already defines a few of these globals (e.g. `navigator`,
  // Node 21+) as getter-only, so `Object.assign` would throw trying to
  // overwrite them — `defineProperty` with `configurable: true` replaces
  // them outright instead.
  const set = (target: object, prop: string, value: unknown): void => {
    Object.defineProperty(target, prop, { value, writable: true, configurable: true });
  };

  set(globalThis, 'window', window);
  set(globalThis, 'document', window.document);
  set(globalThis, 'navigator', window.navigator);
  set(globalThis, 'HTMLElement', window.HTMLElement);
  set(globalThis, 'Element', window.Element);
  set(globalThis, 'Node', window.Node);
  set(globalThis, 'requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
  set(globalThis, 'cancelAnimationFrame', (id: number) => clearTimeout(id));
  copyProps(window, globalThis);
} catch {
  // esbuild/jsdom aren't installed — fine for the domain suite, which
  // needs neither; only running/adding a component test needs `npm
  // install` first, at which point importing a .tsx file or rendering
  // into `document` will fail loudly and obviously instead.
}
