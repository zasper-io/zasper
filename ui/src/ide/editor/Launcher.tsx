import React, { useEffect, useCallback } from 'react';
import './Launcher.scss';
import { BaseApiUrl } from '@/config';
import { ContentType, createContent, listKernelspecs } from '@/api';
import { useAtom } from 'jotai';
import {
  kernelspecsAtom,
  terminalsCountAtom,
  terminalsAtom,
  fileBrowserReloadCountAtom,
  languageModeAtom,
} from '@/store/AppState';
import { fileTabsAtom, IfileTab } from '@/store/TabState';
import getFileExtension from '../utils';
import { TerminalIcon } from '../icons';

interface LauncherProps {
  data: {
    active: boolean;
  };
}

const Launcher: React.FC<LauncherProps> = ({ data }) => {
  const [kernelspecs, setKernelspecs] = useAtom(kernelspecsAtom);
  const [terminalCount, setTerminalCount] = useAtom(terminalsCountAtom);
  const [terminals, setTerminals] = useAtom(terminalsAtom);
  const [reloadCount, setReloadCount] = useAtom(fileBrowserReloadCountAtom);

  // Fetch kernelspecs from the API
  const fetchData = useCallback(async () => {
    try {
      setKernelspecs(await listKernelspecs());
    } catch (error) {
      console.error('Error fetching kernelspecs:', error);
    }
  }, [setKernelspecs]);

  const [fileTabsState, setFileTabsState] = useAtom(fileTabsAtom);
  const [, setLanguageMode] = useAtom(languageModeAtom);

  const handleTabActivate = (name: string, path: string, type: string, kernelspec: string) => {
    const updatedFileTabs = { ...fileTabsState };
    const fileTabData: IfileTab = {
      type,
      path,
      name,
      extension: getFileExtension(name),
      active: true,
      load_required: true,
      kernelspec: kernelspec,
    };

    Object.keys(updatedFileTabs).forEach((key) => {
      updatedFileTabs[key] = {
        ...updatedFileTabs[key],
        active: false,
        load_required: false,
      };
    });
    if (updatedFileTabs[path]) {
      updatedFileTabs[path] = { ...updatedFileTabs[path], active: true };
    } else {
      updatedFileTabs[path] = fileTabData;
    }
    if (updatedFileTabs[path].extension) {
      setLanguageMode(updatedFileTabs[path].extension);
    }

    setFileTabsState(updatedFileTabs);
  };

  const createNewNotebook = async (path: string, contentType: ContentType, kernelspec: string) => {
    const created = await createContent(path, contentType);
    handleTabActivate(created.name, created.path, 'notebook', kernelspec);
    setReloadCount(reloadCount + 1);
  };

  // Handle opening a new terminal
  const openTerminal = () => {
    const terminalName = 'Terminal ' + (terminalCount + 1);
    handleTabActivate(terminalName, terminalName, 'terminal', '');
    setTerminalCount(terminalCount + 1);
    var updatedterminals = { ...terminals };
    updatedterminals[terminalName] = { id: terminalName, name: terminalName };
    setTerminals(updatedterminals);
  };

  const getLogoUrl = (resources: Record<string, string>) => {
    const logoPath = resources['logo-svg'] || resources['logo-64x64'] || resources['logo-32x32'];
    return `${BaseApiUrl}${logoPath}`;
  };

  // Fetch kernelspecs on component mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="LauncherArea">
      <div className="launcher-title">
        <h2 className="font-h3 fontw-300">
          Welcome to <span className="fontw-500">zasper</span>
        </h2>
      </div>
      <div className="launchSection">
        <h2 className="font-h5 fontw-300">Notebook</h2>
        {Object.keys(kernelspecs).length > 0 ? (
          Object.keys(kernelspecs).map((key) => (
            <div
              className="launcher-icon"
              key={key}
              onClick={() => createNewNotebook('', 'notebook', kernelspecs[key].name)}
            >
              <div className="kernelSpecIconArea">
                <img
                  className="resourceLogoImage"
                  src={getLogoUrl(kernelspecs[key].resources)}
                  alt="logo"
                />
              </div>
              <div className="kernelspecDisplayName">{kernelspecs[key].spec.display_name}</div>
            </div>
          ))
        ) : (
          <NoKernelsFound />
        )}
      </div>

      <div className="launchSection">
        <h2 className="font-h5 fontw-300">Terminal</h2>
        <div className="launcher-icon" onClick={openTerminal}>
          <TerminalIcon />
        </div>
      </div>
    </div>
  );
};

const NoKernelsFound: React.FC = () => {
  return (
    <div className="noKernelsFound">
      <h3 className="font-h6 fontw-300">❌ No kernels available</h3>
      <p>Please install a kernel to create a new notebook.</p>
      <code>
        pip install ipykernel
        <br />
      </code>
      <p>
        Check docs on our{' '}
        <a
          href="https://zasper.io/docs/installing-jupyter-kernels"
          target="_blank"
          rel="noreferrer"
        >
          website
        </a>
      </p>
    </div>
  );
};

export default Launcher;
