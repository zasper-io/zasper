import { useEffect, useMemo, useState } from 'react';

import { OutputBundles } from '@/ide/editor/notebook/CellOutput';
import { Icon } from '@/ide/icons';
import {
  CellDiff,
  DiffCell,
  DiffLine,
  diffNotebooks,
  lineDiff,
  NotebookSide,
  outputsAsText,
  personalMetadata,
  stableJson,
} from './cellDiff';
import './NotebookDiff.scss';

interface NotebookDiffProps {
  original: NotebookSide | null;
  modified: NotebookSide | null;
  /** What each side is called: HEAD, Index, Working tree, a commit. */
  sides: [string, string];
  /** The strip's switches: every output change open, every metadata change open. */
  outputsOpen: boolean;
  metadataOpen: boolean;
}

const KIND_LABEL: Record<string, string> = { code: 'Code', markdown: 'Markdown', raw: 'Raw' };

function Marked({ line }: { line: DiffLine }) {
  if (!line.marks || line.marks.length === 0) {
    return <>{line.text}</>;
  }
  const parts: React.ReactNode[] = [];
  let at = 0;
  line.marks.forEach(([from, to], index) => {
    parts.push(line.text.slice(at, from));
    parts.push(<mark key={index}>{line.text.slice(from, to)}</mark>);
    at = to;
  });
  parts.push(line.text.slice(at));
  return <>{parts}</>;
}

function Lines({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="nbDiff-lines">
      {lines.map((line, index) => (
        <div
          key={index}
          className={line.kind === 'same' ? 'nbDiff-line' : `nbDiff-line is-${line.kind}`}
        >
          <span className="n">{line.oldNumber ?? ''}</span>
          <span className="n">{line.newNumber ?? ''}</span>
          <span className="sign">
            {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}
          </span>
          <span className="t">
            <Marked line={line} />
          </span>
        </div>
      ))}
    </div>
  );
}

function place(cell: CellDiff): string {
  const before = cell.old ? String(cell.old.index + 1) : '·';
  const after = cell.new ? String(cell.new.index + 1) : '·';
  return before === after ? after : `${before} → ${after}`;
}

function stateOf(cell: CellDiff): string {
  const also = [cell.outputsChanged ? 'outputs' : '', cell.metadataChanged ? 'metadata' : '']
    .filter(Boolean)
    .join(' and ');
  switch (cell.change) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'edited':
      return also ? `edited · ${also} changed` : 'edited';
    case 'moved':
      return also ? `moved · ${also} changed` : 'moved, not edited';
    case 'outputs':
      return `${also} changed · source the same`;
    default:
      return '';
  }
}

/** The representations an output arrived in, as a reader names them. */
function kindsOf(cell: DiffCell | undefined): string {
  const kinds = new Set<string>();
  for (const output of cell?.outputs ?? []) {
    if (output.output_type === 'stream') {
      kinds.add(output.name === 'stderr' ? 'stderr' : 'stdout');
    } else if (output.output_type === 'error') {
      kinds.add('error');
    } else {
      const data = Object.keys(output.data ?? {}).filter(
        (kind) => !kind.startsWith('application/vnd.zasper')
      );
      const richest = data.find((kind) => kind !== 'text/plain') ?? data[0];
      if (richest) {
        kinds.add(richest);
      }
    }
  }
  return [...kinds].join(', ');
}

function Part({
  title,
  detail,
  open,
  onToggle,
  children,
}: {
  title: string;
  detail: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="nbDiff-part">
      <button type="button" className="nbDiff-partToggle" aria-expanded={open} onClick={onToggle}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <strong>{title}</strong> · {detail}
      </button>
      {open && children}
    </div>
  );
}

function OutputsBody({ cell, sides }: { cell: CellDiff; sides: [string, string] }) {
  const before = cell.old?.cell;
  const after = cell.new?.cell;
  if (cell.change !== 'added' && cell.change !== 'removed') {
    const oldText = outputsAsText(before);
    const newText = outputsAsText(after);
    if (oldText !== null && newText !== null) {
      return <Lines lines={lineDiff(oldText, newText)} />;
    }
  }
  const shown: [string, DiffCell][] = [];
  if (before && cell.change !== 'added') {
    shown.push([sides[0], before]);
  }
  if (after && cell.change !== 'removed') {
    shown.push([sides[1], after]);
  }
  return (
    <div className={shown.length === 1 ? 'nbDiff-outputs is-one' : 'nbDiff-outputs'}>
      {shown.map(([label, side]) => (
        <div key={label}>
          <span className="nbDiff-side">{label}</span>
          {(side.outputs ?? []).length === 0 ? (
            <p className="z-note">No output.</p>
          ) : (
            <OutputBundles outputs={side.outputs ?? []} widgets={null} />
          )}
        </div>
      ))}
    </div>
  );
}

function metadataLines(before: DiffCell | undefined, after: DiffCell | undefined): DiffLine[] {
  const pretty = (cell: DiffCell | undefined) =>
    cell ? JSON.stringify(JSON.parse(stableJson(personalMetadata(cell))), null, 2) : '';
  return lineDiff(pretty(before), pretty(after)).filter((line) => line.kind !== 'same');
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => stableJson(before[key]) !== stableJson(after[key]))
    .sort()
    .join(', ');
}

function Card({
  cell,
  sides,
  outputsOpen,
  metadataOpen,
}: {
  cell: CellDiff;
  sides: [string, string];
  outputsOpen: boolean;
  metadataOpen: boolean;
}) {
  const [outputs, setOutputs] = useState(outputsOpen);
  const [metadata, setMetadata] = useState(metadataOpen);
  useEffect(() => setOutputs(outputsOpen), [outputsOpen]);
  useEffect(() => setMetadata(metadataOpen), [metadataOpen]);

  const subject = cell.new?.cell ?? cell.old!.cell;
  const lines = lineDiff(
    cell.change === 'added' ? '' : cell.old!.cell.source,
    cell.change === 'removed' ? '' : cell.new!.cell.source
  );
  const outputCount =
    cell.change === 'removed'
      ? (cell.old?.cell.outputs ?? []).length
      : (cell.new?.cell.outputs ?? []).length;
  const outputsDetail =
    cell.change === 'added'
      ? `${outputCount} added: ${kindsOf(cell.new?.cell)}`
      : cell.change === 'removed'
        ? `${outputCount} removed: ${kindsOf(cell.old?.cell)}`
        : `changed: ${kindsOf(cell.new?.cell) || kindsOf(cell.old?.cell) || 'cleared'}`;

  return (
    <div
      className={[
        'nbDiff-cell',
        `is-${cell.change}`,
        subject.cell_type === 'markdown' ? 'is-markdown' : '',
      ].join(' ')}
    >
      <div className="nbDiff-head">
        <span className="nbDiff-place z-tabular">{place(cell)}</span>
        <strong>{KIND_LABEL[subject.cell_type] ?? subject.cell_type}</strong>
        <span className={`nbDiff-state is-${cell.change}`}>{stateOf(cell)}</span>
      </div>
      <Lines lines={lines} />
      {cell.outputsChanged && (
        <Part
          title="Outputs"
          detail={outputsDetail}
          open={outputs}
          onToggle={() => setOutputs(!outputs)}
        >
          <OutputsBody cell={cell} sides={sides} />
        </Part>
      )}
      {cell.metadataChanged && (
        <Part
          title="Metadata"
          detail={changedKeys(personalMetadata(cell.old!.cell), personalMetadata(cell.new!.cell))}
          open={metadata}
          onToggle={() => setMetadata(!metadata)}
        >
          <Lines lines={metadataLines(cell.old?.cell, cell.new?.cell)} />
        </Part>
      )}
    </div>
  );
}

/**
 * A notebook's comparison, cell by cell: each cell that changed as a card — its source as a line diff,
 * then its outputs, open, and its metadata — and the cells that did not, folded a run at a time.
 */
export default function NotebookDiff(props: NotebookDiffProps) {
  const { original, modified, sides, outputsOpen, metadataOpen } = props;
  const comparison = useMemo(() => diffNotebooks(original, modified), [original, modified]);
  const [openRuns, setOpenRuns] = useState<Set<number>>(new Set());
  const [notebookMeta, setNotebookMeta] = useState(metadataOpen);
  useEffect(() => setNotebookMeta(metadataOpen), [metadataOpen]);

  const count = (change: CellDiff['change']) =>
    comparison.cells.filter((cell) => cell.change === change).length;
  const changed = comparison.cells.filter((cell) => cell.change !== 'unchanged').length;
  const outputsChanged = comparison.cells.filter(
    (cell) => cell.outputsChanged && cell.old && cell.new
  ).length;
  const metadataChanged = comparison.cells.filter((cell) => cell.metadataChanged).length;
  const sourcesTouched = count('edited') + count('added') + count('removed') + count('moved');

  // Runs of unchanged cells, each folded into one line until opened.
  const blocks: ({ run: CellDiff[]; start: number } | { cell: CellDiff })[] = [];
  comparison.cells.forEach((cell, index) => {
    const last = blocks[blocks.length - 1];
    if (cell.change === 'unchanged') {
      if (last && 'run' in last) {
        last.run.push(cell);
      } else {
        blocks.push({ run: [cell], start: index });
      }
    } else {
      blocks.push({ cell });
    }
  });

  const counts: [string, number][] = [
    ['edited', count('edited')],
    ['added', count('added')],
    ['removed', count('removed')],
    ['moved', count('moved')],
  ];

  return (
    <div className="nbDiff">
      {changed === 0 && !comparison.metadataChanged && (
        <div className="z-notice">
          <p>No changes.</p>
        </div>
      )}
      {changed > 0 && sourcesTouched === 0 && (
        <div className="z-notice">
          <Icon name="info" size={14} />
          <p>
            Only {outputsChanged > 0 ? 'outputs' : 'metadata'} changed. No cell&rsquo;s source was
            edited, added, removed or moved.
          </p>
        </div>
      )}
      {changed > 0 && (
        <div className="nbDiff-summary">
          <strong>
            {changed} of {comparison.cells.length} cells changed
          </strong>
          {counts
            .filter(([, n]) => n > 0)
            .map(([change, n]) => (
              <span key={change} className={`nbDiff-count is-${change}`}>
                {n} {change}
              </span>
            ))}
          {(outputsChanged > 0 || metadataChanged > 0) && (
            <span>
              {[
                outputsChanged > 0 ? `outputs changed in ${outputsChanged}` : '',
                metadataChanged > 0 ? `metadata in ${metadataChanged}` : '',
              ]
                .filter(Boolean)
                .map((part) => `· ${part}`)
                .join(' ')}
            </span>
          )}
        </div>
      )}

      {comparison.metadataChanged && (
        <div className="nbDiff-cell is-outputs">
          <div className="nbDiff-head">
            <strong>Notebook metadata</strong>
            <span className="nbDiff-state is-outputs">changed</span>
          </div>
          <Part
            title="Metadata"
            detail={changedKeys(original?.metadata ?? {}, modified?.metadata ?? {})}
            open={notebookMeta}
            onToggle={() => setNotebookMeta(!notebookMeta)}
          >
            <Lines
              lines={lineDiff(
                JSON.stringify(JSON.parse(stableJson(original?.metadata ?? {})), null, 2),
                JSON.stringify(JSON.parse(stableJson(modified?.metadata ?? {})), null, 2)
              ).filter((line) => line.kind !== 'same')}
            />
          </Part>
        </div>
      )}

      {blocks.map((block, index) =>
        'run' in block ? (
          openRuns.has(block.start) ? (
            block.run.map((cell, at) => (
              <Card
                key={`run-${block.start}-${at}`}
                cell={cell}
                sides={sides}
                outputsOpen={outputsOpen}
                metadataOpen={metadataOpen}
              />
            ))
          ) : (
            <button
              key={`run-${block.start}`}
              type="button"
              className="nbDiff-fold"
              onClick={() => setOpenRuns(new Set([...openRuns, block.start]))}
            >
              <Icon name="chevron-right" size={12} />
              {block.run.length} unchanged {block.run.length === 1 ? 'cell' : 'cells'}
            </button>
          )
        ) : (
          <Card
            key={`cell-${index}`}
            cell={block.cell}
            sides={sides}
            outputsOpen={outputsOpen}
            metadataOpen={metadataOpen}
          />
        )
      )}
    </div>
  );
}
