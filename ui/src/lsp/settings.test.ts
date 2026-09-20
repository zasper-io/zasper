import { describe, expect, it } from 'vitest';

import { interpreterOfKernel, pushedSettings, serverSettings, setTypeChecking } from './settings';

describe('serverSettings', () => {
  // basedpyright's own default reports every expression whose type it cannot infer, which over an
  // untyped library is a squiggle under most of a correct notebook.
  // pyright's own `off` reports nothing at all, so Zasper's keeps what is wrong whatever the types say —
  // which is what VS Code shows with its own default settings.
  it('checks as little as VS Code does by default, but keeps the essentials', () => {
    expect(serverSettings('python', 'basedpyright')).toEqual({
      analysis: {
        typeCheckingMode: 'off',
        diagnosticSeverityOverrides: {
          reportUndefinedVariable: 'error',
          reportMissingImports: 'error',
          reportMissingModuleSource: 'warning',
        },
      },
    });
  });

  it('passes a stricter mode on as it is, with nothing overridden', () => {
    setTypeChecking('standard');
    expect(serverSettings('python', 'python.analysis')).toEqual({ typeCheckingMode: 'standard' });
    setTypeChecking('');
  });

  it("names the kernel's interpreter, which is where the notebook's imports are installed", () => {
    expect(serverSettings('python', 'python', '/envs/ds/bin/python')).toEqual({
      pythonPath: '/envs/ds/bin/python',
    });
    expect(serverSettings('python', 'python')).toEqual({});
  });

  it('has nothing to say about a server it has no opinion about', () => {
    expect(serverSettings('go', 'gopls')).toEqual({});
    expect(serverSettings('python', undefined)).toHaveProperty('basedpyright');
  });
});

describe('interpreterOfKernel', () => {
  // The default `python3` spec names `python`, so the server resolving it is the whole point.
  it('takes what the server resolved the kernel command to', () => {
    expect(
      interpreterOfKernel({ interpreter: '/usr/bin/python3', spec: { argv: ['python', '-m'] } })
    ).toBe('/usr/bin/python3');
  });

  it('falls back to the command itself when that is already a path', () => {
    expect(interpreterOfKernel({ spec: { argv: ['/envs/ds/bin/python', '-m'] } })).toBe(
      '/envs/ds/bin/python'
    );
    expect(interpreterOfKernel({ spec: { argv: ['python3', '-m'] } })).toBeUndefined();
    expect(interpreterOfKernel(undefined)).toBeUndefined();
  });
});

describe('pushedSettings', () => {
  // pylsp never asks for its settings, and it is jedi rather than pythonPath that takes an environment.
  it('carries the interpreter in the shape each server understands', () => {
    const pushed = pushedSettings('python', '/envs/ds/bin/python');

    expect(pushed).toMatchObject({
      python: { pythonPath: '/envs/ds/bin/python' },
      pylsp: { plugins: { jedi: { environment: '/envs/ds/bin/python' } } },
      basedpyright: { analysis: { typeCheckingMode: 'off' } },
    });
  });

  it('says nothing about an interpreter nobody named', () => {
    expect(pushedSettings('python')).toMatchObject({ python: {}, pylsp: {} });
  });
});
