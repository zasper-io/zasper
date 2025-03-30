import React, { useEffect, useCallback } from 'react';
import './Launcher.scss';
import { BaseApiUrl } from '../config';
import { useAtom } from 'jotai';
import {
  kernelspecsAtom,
  terminalsCountAtom,
  terminalsAtom,
  fileBrowserReloadCountAtom,
  languageModeAtom,
} from '../../store/AppState';
import { themeAtom } from '../../store/Settings';
import { fileTabsAtom, IfileTab } from '../../store/TabState';
import getFileExtension from '../utils';

const TerminalIcon = () => {
  const [theme] = useAtom(themeAtom);
  var fill = theme === 'dark' ? 'white' : 'black';

  return (
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" style={{ fill }} height="64px">
      <g>
        <path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9zM3.854 4.146a.5.5 0 1 0-.708.708L4.793 6.5 3.146 8.146a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2z" />
        <path d="M2 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H2zm12 1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12z" />
      </g>
    </svg>
  );
};

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
      const res = await fetch(`${BaseApiUrl}/api/kernelspecs`);
      const resJson = await res.json();
      setKernelspecs(resJson.kernelspecs || {});
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

  const createNewNotebook = async (path: string, contentType: string, kernelspec: string) => {
    const res = await fetch(BaseApiUrl + '/api/contents/create', {
      method: 'POST',
      body: JSON.stringify({ parent_dir: path, type: contentType }),
    });

    const resJson = await res.json();
    handleTabActivate(resJson.name, resJson.path, 'notebook', kernelspec);
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

  const getLogoUrl = (resources) => {
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
              <img
                className="resourceLogoImage"
                src={getLogoUrl(kernelspecs[key].resources)}
                alt="logo"
              />
              <h6>{key}</h6>
            </div>
          ))
        ) : (
          <p>No kernels available.</p>
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

export default Launcher;
