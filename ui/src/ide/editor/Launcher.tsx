import React, { useEffect, useRef, useState } from 'react';
import './Launcher.scss';
import {
  ApiError,
  ContentType,
  IEnvironmentSetup,
  PROJECT_KERNEL_NAME,
  createContent,
  getEnvironmentSetup,
  getKernelspecResource,
  logApiError,
  startEnvironmentSetup,
} from '@/api';
import { useAtom, useAtomValue } from 'jotai';
import {
  kernelspecsAtom,
  kernelspecsStatusAtom,
  fileBrowserReloadCountAtom,
} from '@/store/AppState';
import { useTabActions } from '@/store/TabActions';
import { useKernelspecActions } from '@/store/KernelspecActions';
import { Icon } from '../icons';

interface LauncherProps {
  data: {
    active: boolean;
  };
}

const Launcher: React.FC<LauncherProps> = ({ data }) => {
  // Read on boot by IDE.tsx, not here: the Jupyter info panel wants the same list, and a list fetched
  // by whichever tab is open is one that is missing when that tab is not. The status is what an empty
  // list cannot say — before the read, and after one that failed, there are no kernels either way.
  const kernelspecs = useAtomValue(kernelspecsAtom);
  const status = useAtomValue(kernelspecsStatusAtom);
  const [reloadCount, setReloadCount] = useAtom(fileBrowserReloadCountAtom);
  const { openTab, openTerminal } = useTabActions();
  const { loadKernelspecs } = useKernelspecActions();

  // The project's own environment first: it is the one this folder's notebooks are meant to run on.
  const kernelNames = Object.keys(kernelspecs).sort(
    (a, b) => Number(b === PROJECT_KERNEL_NAME) - Number(a === PROJECT_KERNEL_NAME)
  );

  const createNewNotebook = async (path: string, contentType: ContentType, kernelspec: string) => {
    const created = await createContent(path, contentType);
    openTab({ name: created.name, path: created.path, type: 'notebook', kernelspec });
    setReloadCount(reloadCount + 1);
  };

  return (
    <div className="LauncherArea">
      {/* The type scale comes from styles/_typography.scss. */}
      <div className="launcher-title">
        <h2 className="z-title">
          Welcome to <strong>zasper</strong>
        </h2>
      </div>
      <div className="launchSection">
        <h2 className="z-heading">Notebook</h2>
        {status === 'loading' ? (
          <p className="z-note">
            <span className="z-spinner" />
            Looking for installed kernels…
          </p>
        ) : status === 'failed' ? (
          <KernelspecsUnavailable onRetry={loadKernelspecs} />
        ) : kernelNames.length > 0 ? (
          <div className="launchSection-grid">
            {kernelNames.map((key) => (
              <button
                type="button"
                className="launcher-icon"
                key={key}
                onClick={() => createNewNotebook('', 'notebook', kernelspecs[key].name)}
              >
                <div className="kernelSpecIconArea">
                  <KernelLogo resources={kernelspecs[key].resources} />
                </div>
                <div className="launcher-icon-label">{kernelspecs[key].spec.display_name}</div>
              </button>
            ))}
          </div>
        ) : (
          <NoKernelsFound onRetry={loadKernelspecs} />
        )}
      </div>

      <div className="launchSection">
        <h2 className="z-heading">Terminal</h2>
        <div className="launchSection-grid">
          <button type="button" className="launcher-icon" onClick={() => openTerminal()}>
            {/* Sized to 44px in CSS, beside the kernel logos: a tile is one row of one grid. */}
            <Icon name="terminal" />
            <div className="launcher-icon-label">Terminal</div>
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * A kernel's logo, and the kernel glyph when there is none to show.
 *
 * The one picture on screen from outside the icon set, and it stays: a kernel's logo is its
 * identity. `alt=""` because the name is under it.
 *
 * Jupyter promises no logo, though. A kernelspec directory without one leaves `resources` empty —
 * and the file a spec does name can be missing, which is the same broken tile by a different route.
 * Both drew an image with `src` set to the string "undefined", since that is what a template literal
 * makes of one.
 *
 * Fetched rather than linked: an `<img>` request cannot carry the session, so a linked logo is a 401.
 */
const KernelLogo: React.FC<{ resources: Record<string, string> }> = ({ resources }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
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
    return <Icon name="cpu" />;
  }
  return <img src={src} alt="" onError={() => setUnavailable(true)} />;
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
  const [setup, setSetup] = useState<IEnvironmentSetup | null>(null);
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
        <p>Or install one yourself:</p>
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
