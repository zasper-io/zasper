import { describe, expect, it } from 'vitest';

import { fileUri, notebookLanguageFor, pathOfUri, serverLanguageFor } from './languages';

describe('serverLanguageFor', () => {
  it('names the server and the document language a file is opened with', () => {
    expect(serverLanguageFor('main.go')).toEqual({ server: 'go', languageId: 'go' });
    expect(serverLanguageFor('App.TSX')).toEqual({
      server: 'typescript',
      languageId: 'typescriptreact',
    });
    expect(serverLanguageFor('sum.cpp')).toEqual({ server: 'c', languageId: 'cpp' });
  });

  it('knows no server for a file it has no language for', () => {
    expect(serverLanguageFor('notes.txt')).toBeNull();
    expect(serverLanguageFor('Makefile')).toBeNull();
  });

  it('serves the JVM, .NET, shell, SQL and Haskell files', () => {
    expect(serverLanguageFor('Main.java')?.server).toBe('java');
    expect(serverLanguageFor('build.sc')?.server).toBe('scala');
    expect(serverLanguageFor('App.kt')?.server).toBe('kotlin');
    expect(serverLanguageFor('Program.cs')?.server).toBe('csharp');
    expect(serverLanguageFor('run.sh')).toEqual({ server: 'shell', languageId: 'shellscript' });
    expect(serverLanguageFor('q.sql')?.server).toBe('sql');
    expect(serverLanguageFor('Main.hs')?.server).toBe('haskell');
  });
});

describe('notebookLanguageFor', () => {
  it('serves a notebook whose cells, one after another, are a source file', () => {
    expect(notebookLanguageFor('c++')?.language.server).toBe('c');
    expect(notebookLanguageFor('shell')).toEqual({
      language: { server: 'shell', languageId: 'shellscript' },
      extension: 'sh',
    });
  });

  // A Java cell is a snippet: as one file, nearly every line would be marked wrong.
  it('serves no notebook whose cells are snippets', () => {
    expect(notebookLanguageFor('java')).toBeNull();
    expect(notebookLanguageFor('kotlin')).toBeNull();
  });
});

describe('file URIs', () => {
  it('puts a project path under the project root, and takes it back out', () => {
    const uri = fileUri('/work/rig', 'src/main file.go');

    expect(uri).toBe('file:///work/rig/src/main%20file.go');
    expect(pathOfUri('/work/rig/', uri)).toBe('src/main file.go');
  });

  // A server can publish for a file outside the project — the standard library, say — which has no row.
  it('has no project path for a file outside the project', () => {
    expect(pathOfUri('/work/rig', 'file:///usr/local/go/src/fmt/print.go')).toBeNull();
    expect(pathOfUri('/work/rig', 'file:///work/rigging/main.go')).toBeNull();
  });
});
