import React from 'react';

interface CellButtonsProps {
  /** Dispatches a command by id — see notebookCommands.ts for the ids. */
  run: (id: string) => void;
}

/**
 * The hover toolbar on a cell. It is only ever rendered for the focused cell (see Cell.tsx), so
 * every button here is an action on the focused cell and needs no index of its own — which is what
 * lets them all be plain command ids.
 */
function CellButtons(props: CellButtonsProps) {
  return (
    <div className="cellOptionsDiv">
      <div className="cellOptions">
        {CELL_BUTTONS.map((button) => (
          <button
            key={button.id}
            type="button"
            className="editor-button"
            onClick={() => props.run(button.id)}
          >
            {button.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

// 16 to match the box `.cellOptions .editor-button` gives the Font Awesome glyphs beside them.
const IconAddAbove = ({ size = 16, color = 'currentColor' }) => {
  const maskId = 'mask-plus-above';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" />
          <path d="M6 12H12M9 9V15" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
        </mask>
      </defs>
      <rect x="1" y="7" width="16" height="10" rx="2" fill={color} mask={`url(#${maskId})`} />
      <path
        d="M19 11L21.5 8.5L24 11"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M21.5 8.5V16" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

const IconAddBelow = ({ size = 16, color = 'currentColor' }) => {
  const maskId = 'mask-plus-below';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" />
          <path d="M6 12H12M9 9V15" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
        </mask>
      </defs>
      <rect x="1" y="7" width="16" height="10" rx="2" fill={color} mask={`url(#${maskId})`} />
      <path
        d="M19 13L21.5 15.5L24 13"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M21.5 15.5V8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

// Below the icon components because it holds elements built from them: a module-level array
// evaluated above their `const` declarations would read them before they are initialised.
const CELL_BUTTONS: { id: string; icon: React.ReactNode }[] = [
  { id: 'notebook:run-cell', icon: <i className="fas fa-play" /> },
  { id: 'notebook:copy-cell', icon: <i className="fas fa-copy" /> },
  { id: 'notebook:select-next-cell', icon: <i className="fas fa-forward" /> },
  { id: 'notebook:select-previous-cell', icon: <i className="fas fa-backward" /> },
  { id: 'notebook:insert-cell-above', icon: <IconAddAbove /> },
  { id: 'notebook:insert-cell-below', icon: <IconAddBelow /> },
  { id: 'notebook:delete-cell', icon: <i className="fas fa-trash" /> },
];

export default CellButtons;
