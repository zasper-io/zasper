import IconButton from '@/ide/IconButton';

import { headingKey, NotebookHeading, sectionOfCell } from './notebookHeadings';
import './NotebookOutline.scss';

interface NotebookOutlineProps {
  headings: NotebookHeading[];
  /** Which cell has the focus, so the table can mark the section that is. */
  focusedIndex: number;
  /** Where the kernel is working, as cell indexes, so the section holding it can say so. */
  runningIndexes: number[];
  /** Scrolls that cell into view and focuses it. */
  onGoTo: (cellIndex: number) => void;
  onClose: () => void;
}

/**
 * A notebook's headings, in a column beside its cells.
 *
 * The column belongs to the notebook rather than to the window: it is switched from the notebook's own
 * toolbar, so it is up for the notebook that wants it and absent from the file in the next tab. That is
 * what it was chosen for over a panel on the rail, which would have taken the file tree's place and
 * then stood empty with a terminal in front.
 *
 * It does not scroll with the cells — `.notebook-body` keeps its own overflow and this keeps another,
 * because a table of contents that scrolls out of the window is one nobody can reach.
 */
export default function NotebookOutline(props: NotebookOutlineProps) {
  const current = sectionOfCell(props.headings, props.focusedIndex);
  const busy = new Set(props.runningIndexes.map((index) => sectionOfCell(props.headings, index)));

  return (
    <aside className="notebook-outline" aria-label="Table of contents">
      <div className="outline-head">
        <span className="z-label">Contents</span>
        <IconButton icon="x" label="Hide the table of contents" onClick={props.onClose} />
      </div>
      {props.headings.length === 0 ? (
        // The state most notebooks in the wild are in, which is why the column is off by default.
        <p className="z-note">No headings in this notebook.</p>
      ) : (
        <ul className="outline-list">
          {props.headings.map((heading, index) => (
            <li key={headingKey(heading)}>
              {/* Deeper than the third level indents to the third: the column is 200px, and past
                  that the indent is eating the words it is indenting. */}
              <button
                type="button"
                className={`panel-row outline-row is-level-${Math.min(heading.level, 3)}${
                  index === current ? ' is-selected' : ''
                }`}
                aria-current={index === current ? 'true' : undefined}
                onClick={() => props.onGoTo(heading.cellIndex)}
              >
                <span className="panel-row-label">{heading.text}</span>
                {busy.has(index) && (
                  <span
                    className="kernelStatus kernelStatus-sm ks-busy"
                    title="The running cell is in here"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
