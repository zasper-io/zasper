import React, { useEffect, useMemo, useRef, useState } from 'react';
import './Launcher.scss';
import {
  ApiError,
  ContentType,
  EnvironmentSetup,
  PROJECT_KERNEL_NAME,
  createContent,
  deleteKernel,
  deleteTerminal,
  getEnvironmentSetup,
  getKernelspecResource,
  logApiError,
  startEnvironmentSetup,
} from '@/api';
import { useAtom, useAtomValue } from 'jotai';
import { Kernelspec, kernelspecsAtom, kernelspecsStatusAtom } from '@/store/kernels';
import { fileBrowserReloadCountAtom } from '@/store/fileBrowser';
import { folderOf, recentFilesAtom } from '@/store/recentFiles';
import { useTabActions } from '@/store/tabActions';
import { fileTabsAtom } from '@/store/tabState';
import { useKernelspecActions } from '@/store/kernelspecActions';
import ConfirmShutdownDialog from '@/ide/sidebar/jupyterInfoPanel/ConfirmShutdownDialog';
import { RunningKernel, useJupyterInfo } from '@/ide/sidebar/jupyterInfoPanel/useJupyterInfo';
import IconButton from '@/ide/IconButton';
import { FileMark, Icon } from '../icons';

/** Rows in the Recent section: enough to recognise the work, not a file browser. */
const RECENT_SHOWN = 6;

interface LauncherProps {
  data: {
    active: boolean;
  };
}

/**
 * Two letters of a kernel's language, for a kernelspec that ships no logo.
 *
 * The fallback used to be the kernel glyph, which at five rows is the same picture five times and says
 * only "this is a kernel" — which the heading above it already said. The language is what the reader is
 * choosing between.
 */
const MARKS: Record<string, string> = {
  python: 'py',
  r: 'r',
  julia: 'jl',
  go: 'go',
  rust: 'rs',
  typescript: 'ts',
  javascript: 'js',
  ruby: 'rb',
  scala: 'sc',
  haskell: 'hs',
  sql: 'sql',
  bash: 'sh',
  c: 'c',
  cpp: 'c++',
};

function markFor(spec: Kernelspec): string {
  const language = spec.spec.language?.toLowerCase() ?? '';
  return MARKS[language] ?? (language || spec.name).slice(0, 2);
}

/** The groups the kernels are drawn in, in this order; a group with nothing in it is not drawn. */
interface KernelGroup {
  label: string;
  names: string[];
}

function groupKernels(kernelspecs: Record<string, Kernelspec>): KernelGroup[] {
  const names = Object.keys(kernelspecs);
  const project = names.filter((name) => name === PROJECT_KERNEL_NAME);
  const isPython = (name: string) =>
    name !== PROJECT_KERNEL_NAME && kernelspecs[name].spec.language?.toLowerCase() === 'python';
  const python = names.filter(isPython).sort();
  const others = names.filter((name) => name !== PROJECT_KERNEL_NAME && !isPython(name)).sort();
  return [
    { label: 'This project', names: project },
    { label: 'Python', names: python },
    { label: 'Other languages', names: others },
  ].filter((group) => group.names.length > 0);
}

const Launcher: React.FC<LauncherProps> = ({ data }) => {
  // Read on boot by IDE.tsx, not here: the Jupyter info panel wants the same list, and a list fetched
  // by whichever tab is open is one that is missing when that tab is not. The status is what an empty
  // list cannot say — before the read, and after one that failed, there are no kernels either way.
  const kernelspecs = useAtomValue(kernelspecsAtom);
  const status = useAtomValue(kernelspecsStatusAtom);
  const [reloadCount, setReloadCount] = useAtom(fileBrowserReloadCountAtom);
  const { openTab } = useTabActions();
  const { loadKernelspecs } = useKernelspecActions();
  const recentFiles = useAtomValue(recentFilesAtom);
  const openTabs = useAtomValue(fileTabsAtom);
  // A file that is still open is a tab away, so the Launcher does not offer it either.
  const recent = recentFiles
    .filter((file) => openTabs[file.path] === undefined)
    .slice(0, RECENT_SHOWN);

  // The project's own environment first, then the Pythons, then a group for everything else: ten
  // kernelspecs is an ordinary laptop, and one to a line they run past the foot of the pane.
  const groups = useMemo(() => groupKernels(kernelspecs), [kernelspecs]);

  const createNewNotebook = async (path: string, contentType: ContentType, kernelspec: string) => {
    const created = await createContent(path, contentType);
    openTab({ name: created.name, path: created.path, type: 'notebook', kernelspec });
    setReloadCount(reloadCount + 1);
  };

  return (
    <div className="LauncherArea">
      <div className="launcher-split">
        <div className="launcher-start">
          <div className="launchSection">
            <h2 className="z-heading">Notebook</h2>
            {status === 'loading' ? (
              <p className="z-note">
                <span className="z-spinner" />
                Looking for installed kernels…
              </p>
            ) : status === 'failed' ? (
              <KernelspecsUnavailable onRetry={loadKernelspecs} />
            ) : groups.length > 0 ? (
              groups.map((group) => (
                <React.Fragment key={group.label}>
                  <div className="z-label launcher-group">{group.label}</div>
                  <div className="launcher-rows">
                    {group.names.map((name) => (
                      <button
                        type="button"
                        className={
                          name === PROJECT_KERNEL_NAME ? 'launcher-row is-project' : 'launcher-row'
                        }
                        key={name}
                        onClick={() => createNewNotebook('', 'notebook', kernelspecs[name].name)}
                      >
                        <KernelArt spec={kernelspecs[name]} />
                        <span className="launcher-row-label">
                          {kernelspecs[name].spec.display_name}
                        </span>
                      </button>
                    ))}
                  </div>
                </React.Fragment>
              ))
            ) : (
              <NoKernelsFound onRetry={loadKernelspecs} />
            )}
          </div>
        </div>

        <div className="launchSection launcher-recent">
          {recent.length > 0 && (
            <>
              <h2 className="z-heading">Recent</h2>
              {/* Rows rather than tiles: a tile is a picture, and a path is a line of text. */}
              <ul className="launcher-list">
                {recent.map((file) => (
                  <li key={file.path} className="panel-row">
                    <button
                      type="button"
                      className="panel-row-name"
                      onClick={() => openTab({ name: file.name, path: file.path, type: file.type })}
                    >
                      <FileMark name={file.name} />
                      <span className="panel-row-label">{file.name}</span>
                    </button>
                    <span className="panel-row-meta">{folderOf(file)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Running hidden={!data.active} />
        </div>
      </div>
    </div>
  );
};

/**
 * What the server says is running, which this window otherwise never mentions: a kernel's own state, a
 * kernel whose notebook nobody has open, and the shells that outlived the tab they were drawn in.
 *
 * Every row here is a fact only the server has — /api/sessions is the one thing that knows which file a
 * kernel belongs to, and `connections: 0` is a kernel still running with its notebook closed, which is
 * why a laptop is warm and nothing on screen said so.
 */
const Running: React.FC<{ hidden: boolean }> = ({ hidden }) => {
  const { kernels, terminals, run } = useJupyterInfo(hidden);
  const kernelspecs = useAtomValue(kernelspecsAtom);
  const { openTab } = useTabActions();
  // The kernel a shutdown has been asked for and not yet confirmed: everything in it goes with it.
  const [pending, setPending] = useState<RunningKernel | null>(null);
  const [shuttingDown, setShuttingDown] = useState(false);

  if (kernels.length === 0 && terminals.length === 0) {
    return null;
  }

  const confirmShutdown = async () => {
    const kernel = pending;
    if (kernel === null) {
      return;
    }
    setShuttingDown(true);
    await run(() => deleteKernel(kernel.id), 'Kernel shut down.');
    setShuttingDown(false);
    setPending(null);
  };

  return (
    <>
      <h2 className="z-heading launcher-subheading">Running</h2>
      <ul className="launcher-list">
        {kernels.map((kernel) => {
          const path = kernel.session?.path;
          const label =
            kernel.session?.name ?? kernelspecs[kernel.name]?.spec.display_name ?? kernel.name;
          return (
            <li key={kernel.id} className="panel-row">
              <button
                type="button"
                className="panel-row-name"
                // A kernel with no session has no file to open, and starting one from here would
                // attach this kernel to whatever was guessed.
                disabled={path === undefined}
                onClick={() =>
                  kernel.session !== undefined &&
                  openTab({
                    name: kernel.session.name,
                    path: kernel.session.path,
                    type: kernel.session.type,
                    kernelspec: kernel.name,
                  })
                }
              >
                {/* The slot is there either way, so the names line up down both lists. */}
                <span className="panel-row-dot">
                  <span className={`kernelStatus kernelStatus-sm ks-${kernel.execution_state}`} />
                </span>
                <span className="panel-row-label">{label}</span>
              </button>
              {/* The count is the fact with no other way in: nothing is listening to this kernel. */}
              {kernel.connections === 0 && <span className="panel-row-meta">no tab</span>}
              <span className="panel-row-actions">
                <IconButton
                  icon="power"
                  label={`Shut down ${label}`}
                  onClick={() => setPending(kernel)}
                />
              </span>
            </li>
          );
        })}
        {terminals.map((terminal) => (
          <li key={terminal.id} className="panel-row">
            <span className="panel-row-name">
              <Icon name="terminal" />
              <span className="panel-row-label">{terminal.name}</span>
            </span>
            {terminal.dir !== '' && <span className="panel-row-meta">{terminal.dir}</span>}
            <span className="panel-row-actions">
              <IconButton
                icon="power"
                label={`Shut down ${terminal.name}`}
                onClick={() => run(() => deleteTerminal(terminal.id), 'Terminal shut down.')}
              />
            </span>
          </li>
        ))}
      </ul>
      {pending !== null && (
        <ConfirmShutdownDialog
          name={kernelspecs[pending.name]?.spec.display_name ?? pending.name}
          path={pending.session?.path}
          shuttingDown={shuttingDown}
          onConfirm={confirmShutdown}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
};

/**
 * A kernel's logo, and the language's letters when it ships none.
 *
 * The logo is the one picture on screen from outside the icon set, and it stays: a kernel's logo is its
 * identity. What replaced the fallback is the language in two letters — the kernel glyph drew the same
 * picture for every spec without one, which said only "this is a kernel".
 */
const KernelArt: React.FC<{ spec: Kernelspec }> = ({ spec }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const resources = spec.resources;
  const logoPath =
    resources?.['logo-svg'] || resources?.['logo-64x64'] || resources?.['logo-32x32'];

  useEffect(() => {
    if (!logoPath) {
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    getKernelspecResource(logoPath)
      .then((blob) => {
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable(true);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [logoPath]);

  if (!logoPath || unavailable || src === null) {
    // aria-hidden, because the kernel's name is beside it and a button named "py Python 3" reads the
    // language twice to anyone listening.
    return (
      <span className="launcher-mark" aria-hidden="true">
        {markFor(spec)}
      </span>
    );
  }
  return (
    <div className="kernelSpecIconArea">
      {/* Fetched rather than linked: an <img> request cannot carry the session, so a linked logo is a
          401. `alt=""` because the name is beside it. */}
      <img src={src} alt="" onError={() => setUnavailable(true)} />
    </div>
  );
};

interface NoticeProps {
  onRetry: () => void;
}

const SETUP_POLL_MS = 1000;

/**
 * No kernel anywhere, and the offer to make one: a .venv in this project with ipykernel in it. Only
 * ever on this click — internal/kernelspec/setup.go says what it will and will not touch.
 *
 * No glyph in the heading: a red mark beside "No kernels available" is the sentence twice.
 */
const NoKernelsFound: React.FC<NoticeProps> = ({ onRetry }) => {
  const [setup, setSetup] = useState<EnvironmentSetup | null>(null);
  const log = useRef<HTMLPreElement>(null);
  const running = setup?.state === 'running';

  useEffect(() => {
    if (setup?.state !== 'running') {
      return;
    }
    const timer = window.setTimeout(() => {
      getEnvironmentSetup()
        .then(setSetup)
        .catch((error) => {
          logApiError('Lost track of the Python kernel setup:')(error);
          setSetup((previous) => ({
            state: 'failed',
            log: previous?.log ?? '',
            error: 'Zasper lost touch with the server while setting up.',
          }));
        });
    }, SETUP_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [setup]);

  useEffect(() => {
    if (setup?.state === 'succeeded') {
      onRetry();
    }
  }, [setup?.state, onRetry]);

  // What matters in a setup's output is usually its last line.
  useEffect(() => {
    if (log.current) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [setup?.log]);

  const startSetup = async () => {
    try {
      setSetup(await startEnvironmentSetup());
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Already running, from another window: follow that one rather than start a second.
        setSetup({ state: 'running', log: '' });
        return;
      }
      logApiError('Could not start setting up a Python kernel:')(error);
      setSetup({ state: 'failed', log: '', error: 'Zasper could not start the setup.' });
    }
  };

  return (
    <div className="noKernelsFound">
      <h3 className="z-subheading">No kernels available</h3>
      <p>
        Zasper found no Jupyter kernel to run a notebook on. It can make one for this project: a
        .venv folder here with ipykernel installed in it. Your other Pythons are left as they are.
      </p>
      {setup?.state === 'failed' && (
        <div className="z-notice z-notice-error" role="alert">
          <Icon name="circle-alert" />
          <p>{setup.error}</p>
        </div>
      )}
      {running ? (
        <p className="z-note">
          <span className="z-spinner" />
          Setting up a Python kernel…
        </p>
      ) : (
        <button type="button" className="z-button" onClick={startSetup}>
          {setup?.state === 'failed' ? 'Try again' : 'Set up a Python kernel'}
        </button>
      )}
      {setup !== null && setup.log !== '' && (
        <pre className="setupLog" ref={log} aria-label="Setup log">
          {setup.log}
        </pre>
      )}
      <div className="noKernelsFound-manual">
        <div className="z-label">Or install one yourself</div>
        <code>pip install ipykernel</code>
        <p>
          Then check again, or read{' '}
          <a
            href="https://zasper.io/docs/installing-jupyter-kernels"
            target="_blank"
            rel="noreferrer"
          >
            installing Jupyter kernels
          </a>
          .
        </p>
        <button
          type="button"
          className="z-button z-button-secondary"
          onClick={onRetry}
          disabled={running}
        >
          Check again
        </button>
      </div>
    </div>
  );
};

// The same box, and a different sentence: nothing is known about the kernels here, which is not the
// same as knowing there are none.
const KernelspecsUnavailable: React.FC<NoticeProps> = ({ onRetry }) => {
  return (
    <div className="noKernelsFound">
      <h3 className="z-subheading">Could not read the installed kernels</h3>
      <p>
        Zasper could not reach the server to ask which kernels are installed. There may be kernels
        here; this window does not know.
      </p>
      <button type="button" className="z-button z-button-secondary" onClick={onRetry}>
        Check again
      </button>
    </div>
  );
};

export default Launcher;
