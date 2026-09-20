/**
 * What a language server is told when it asks for its settings (`workspace/configuration`).
 *
 * Only what Zasper has an opinion about. A project that carries its own configuration — `pyrightconfig.json`,
 * `[tool.basedpyright]` in `pyproject.toml` — still wins: pyright reads those after the client's settings.
 */
/**
 * What `off` keeps: the things that are wrong whatever anyone's types say.
 *
 * pyright's own `off` reports none of them — measured on a file importing a module that does not exist
 * and printing a name that was never defined, it found neither. Pylance keeps them, which is why VS Code
 * with its default settings still tells you about a typo'd import; this is that set.
 */
const ESSENTIALS = {
  reportUndefinedVariable: 'error',
  reportMissingImports: 'error',
  reportMissingModuleSource: 'warning',
};

/**
 * How strictly a Python server checks when Settings says nothing.
 *
 * `off` — with the essentials above — is VS Code's default and now Zasper's. The stricter modes are worth
 * having on code you maintain, and they are one setting away; as a default they call correct code wrong,
 * because a library that publishes no type information (scikit-learn, pandas without pandas-stubs) makes
 * the checker infer a type it cannot narrow and then fault an attribute that is there at runtime.
 */
export const DEFAULT_TYPE_CHECKING = 'off';

let typeChecking = DEFAULT_TYPE_CHECKING;

/** Settings → Language servers → Type checking; '' restores the default. */
export function setTypeChecking(mode: string): void {
  typeChecking = mode === '' ? DEFAULT_TYPE_CHECKING : mode;
}

const DEFAULTS: Record<string, Record<string, unknown>> = {
  python: {
    /*
    basedpyright's own default mode is `recommended`, which reports every expression whose type it cannot
    infer. Over pandas, sklearn or any untyped library that is a squiggle under most of a notebook and not
    an error among them — 17 diagnostics on a correct ten-line cell, against 4 in `standard`, which is what
    pyright itself uses and what the rest of the world calls type checking.
    */
    'python.analysis': {},
    // basedpyright asks under its own name, and takes its analysis settings nested.
    basedpyright: { analysis: {} },
    // pylsp neither reads pythonPath nor checks types: what it has is jedi, and jedi takes an
    // environment. Measured against pylsp 1.15: `pd.read_c` offers nothing without it, and read_csv
    // and read_clipboard with it.
    pylsp: {},
  },
};

/**
 * The settings for one section, for one server.
 *
 * `interpreter` is the Python a notebook's kernel runs, which is the only thing that knows where its
 * imports are installed: without it the server reads the `python` on the PATH, every third-party import
 * fails to resolve, and everything computed from one is reported as unknown.
 */
export function serverSettings(
  server: string,
  section: string | undefined,
  interpreter?: string
): unknown {
  const settings = DEFAULTS[server] ?? {};
  if (section === undefined) {
    return settings;
  }
  const value = settings[section] ?? {};
  if (section === 'python' && interpreter !== undefined && interpreter !== '') {
    return { ...(value as Record<string, unknown>), pythonPath: interpreter };
  }
  if (server === 'python' && section === 'python.analysis') {
    return { ...(value as Record<string, unknown>), ...pythonAnalysis() };
  }
  if (server === 'python' && section === 'basedpyright') {
    return { analysis: pythonAnalysis() };
  }
  if (
    server === 'python' &&
    section === 'pylsp' &&
    interpreter !== undefined &&
    interpreter !== ''
  ) {
    return { plugins: { jedi: { environment: interpreter } } };
  }
  return value;
}

/**
 * Every section at once, for a server that expects its settings pushed rather than asked for — pylsp
 * never asks, and pyright takes a push as a reason to read them again.
 */
/** What a pyright-family server is told to check, and how strictly. */
function pythonAnalysis(): Record<string, unknown> {
  return {
    typeCheckingMode: typeChecking,
    ...(typeChecking === 'off' ? { diagnosticSeverityOverrides: ESSENTIALS } : {}),
  };
}

export function pushedSettings(server: string, interpreter?: string): Record<string, unknown> {
  const sections = Object.keys(DEFAULTS[server] ?? {});
  return Object.fromEntries(
    ['python', ...sections].map((section) => [
      section,
      serverSettings(server, section, interpreter),
    ])
  );
}

/**
 * The interpreter a kernel runs: what the server resolved its command to, and otherwise the command
 * itself when that is already a path.
 *
 * The default `python3` kernelspec names `python`, which only a PATH can resolve and the browser has
 * none — so without the server's answer the most ordinary notebook of all would tell its language server
 * nothing, and every import in it would go unresolved.
 */
export function interpreterOfKernel(
  kernel: { interpreter?: string; spec?: { argv?: string[] } } | undefined
): string | undefined {
  if (kernel?.interpreter !== undefined && kernel.interpreter !== '') {
    return kernel.interpreter;
  }
  const command = kernel?.spec?.argv?.[0];
  return command !== undefined && command.startsWith('/') ? command : undefined;
}
