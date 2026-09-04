import requirejsUrl from 'requirejs/require.js?url';

/** Hands out the JavaScript of the module a widget names, by whatever means that module needs. */
export type WidgetModuleLoader = (moduleName: string, moduleVersion: string) => Promise<unknown>;

const CDN = 'https://cdn.jsdelivr.net/npm/';

/**
 * requirejs gives up on a module it has not seen load after this long. The default is seven seconds,
 * which a first visit to the CDN for a megabyte of plotting library can lose to.
 */
const LOAD_TIMEOUT_SECONDS = 60;

interface AmdRequire {
  (deps: string[], onLoad: (module: unknown) => void, onError: (error: unknown) => void): void;
  config(options: { paths?: Record<string, string>; waitSeconds?: number }): void;
}

interface AmdWindow extends Window {
  requirejs?: AmdRequire;
  define?: (name: string, factory: () => unknown) => void;
}

/**
 * jsdelivr's URL for a module, following ipywidgets' own convention: `foo/bar` is the file `bar` of
 * package `foo`, and a bare `foo` is that package's `index`. No `.js`, which requirejs appends.
 */
function cdnUrl(moduleName: string, moduleVersion: string): string {
  let separator = moduleName.indexOf('/');
  if (separator !== -1 && moduleName.startsWith('@')) {
    // A scoped name has one slash before the package even begins: @foo/bar/baz is baz of @foo/bar.
    separator = moduleName.indexOf('/', separator + 1);
  }
  const packageName = separator === -1 ? moduleName : moduleName.slice(0, separator);
  const fileName = separator === -1 ? 'index' : moduleName.slice(separator + 1);
  return `${CDN}${packageName}@${moduleVersion}/dist/${fileName}`;
}

/**
 * Builds the loader a widget manager looks modules up through, given the ones it should answer with
 * itself rather than fetch.
 *
 * A widget library is two halves — a Python package and a JavaScript bundle — and pip installs only
 * the Python one. Rather than bundle every library anyone might import, the JavaScript is fetched
 * from jsdelivr the first time a widget names it, which is how ipywidgets' own embedding does it: the
 * name and version come from the widget's state (`_model_module`, `_model_module_version`).
 *
 * Those bundles are AMD and declare ipywidgets itself as an external dependency, so requirejs is
 * loaded first and the local modules are registered under their own names. A bundle that fetched its
 * own copy of `@jupyter-widgets/base` would build models belonging to a different ipywidgets than the
 * one displaying them, and none of the two would recognise the other's.
 */
export function createCdnLoader(localModules: Record<string, unknown>): WidgetModuleLoader {
  const amdWindow = window as AmdWindow;
  let requirejsReady: Promise<AmdRequire> | undefined;

  const loadRequirejs = (): Promise<AmdRequire> =>
    (requirejsReady ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = requirejsUrl;
      script.onload = () => {
        const requirejs = amdWindow.requirejs;
        const define = amdWindow.define;
        if (!requirejs || !define) {
          reject(new Error('requirejs loaded but left no loader behind'));
          return;
        }
        requirejs.config({ waitSeconds: LOAD_TIMEOUT_SECONDS });
        for (const [name, module] of Object.entries(localModules)) {
          define(name, () => module);
        }
        resolve(requirejs);
      };
      script.onerror = () =>
        reject(new Error('could not load requirejs, which widget libraries are loaded through'));
      document.head.appendChild(script);
    }));

  return async (moduleName, moduleVersion) => {
    if (moduleName in localModules) {
      return localModules[moduleName];
    }

    const requirejs = await loadRequirejs();
    requirejs.config({ paths: { [moduleName]: cdnUrl(moduleName, moduleVersion) } });
    return new Promise((resolve, reject) => {
      requirejs(
        [moduleName],
        (module) => resolve(module),
        (error) =>
          reject(
            new Error(`could not load ${moduleName}@${moduleVersion} from ${CDN}: ${String(error)}`)
          )
      );
    });
  };
}
