import { useEffect, useRef, useState } from 'react';

import { ColumnKind, ColumnProfile, RowSort } from '@/api';
import { Icon, IconName } from '@/ide/icons';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import { currentZoomFactor } from '@/zoom';
import Distribution from './Distribution';
import { cellText, formatNumber } from './filters';

const MENU_WIDTH = 220;

interface ColumnHeaderProps {
  index: number;
  name: string;
  dtype: string;
  kind: ColumnKind;
  profile: ColumnProfile | undefined;
  sort: RowSort | null;
  queryable: boolean;
  onSort: (sort: RowSort | null) => void;
  onFilter: (column: number) => void;
  /** The column's width once the reader has dragged it, in CSS pixels. */
  width: number | undefined;
  onResize: (width: number) => void;
  onHide: () => void;
  /** Moves the column one place along: -1 left, 1 right. Undefined where it cannot go. */
  onMoveLeft: (() => void) | undefined;
  onMoveRight: (() => void) | undefined;
  /** Dragging one header onto another moves it there. */
  onDropColumn: (from: number) => void;
}

const MIN_WIDTH = 48;
const DRAGGED = 'application/x-zasper-column';

function MenuAction({
  icon,
  label,
  onSelect,
}: {
  icon: IconName;
  label: string;
  onSelect: () => void;
}) {
  return (
    <li role="none">
      <button type="button" className="panel-row" role="menuitem" onClick={onSelect}>
        <Icon name={icon} size={12} />
        <span className="panel-row-label">{label}</span>
      </button>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <li className="panel-row dataGrid-stat" role="none">
      <span className="panel-row-label">{label}</span>
      <span className="panel-row-meta">{value}</span>
    </li>
  );
}

function stats(profile: ColumnProfile): { label: string; value: string }[] {
  const share = profile.count === 0 ? 0 : (profile.missing / profile.count) * 100;
  const rows = [
    { label: 'Rows', value: formatNumber(profile.count) },
    {
      label: 'Missing',
      value: `${formatNumber(profile.missing)} (${share.toFixed(share > 0 && share < 1 ? 1 : 0)}%)`,
    },
  ];
  if (profile.distinct !== null) {
    rows.push({ label: 'Distinct', value: formatNumber(profile.distinct) });
  }
  if (profile.min !== undefined) {
    rows.push({ label: 'Min', value: formatNumber(profile.min) });
    rows.push({ label: 'Max', value: formatNumber(profile.max) });
  }
  if (profile.mean !== undefined) {
    rows.push({ label: 'Mean', value: formatNumber(profile.mean) });
  }
  if (profile.std !== undefined) {
    rows.push({ label: 'Std dev', value: formatNumber(profile.std) });
  }
  for (const top of profile.top ?? []) {
    rows.push({ label: cellText(top.value), value: formatNumber(top.count) });
  }
  return rows;
}

/** A column's name, type and shape, and the menu that sorts, filters and describes it. */
export default function ColumnHeader(props: ColumnHeaderProps) {
  const { index, name, dtype, kind, profile, sort, queryable, onSort, onFilter, width } = props;
  const [dropping, setDropping] = useState(false);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ top: 0, left: 0 });
  const header = useRef<HTMLTableCellElement>(null);
  const close = () => setOpen(false);
  useDismissOnEscape(close, open);
  useDismissOnPressOutside(header, close, open);

  // Fixed rather than absolute: a cell's output box scrolls, and a menu inside it would be clipped by it.
  // A scroll anywhere would leave it pointing at nothing, so one closes it.
  const toggle = () => {
    if (!open && header.current !== null) {
      const box = header.current.getBoundingClientRect();
      const factor = currentZoomFactor();
      setAt({
        top: (box.bottom + 2) / factor,
        left: Math.max(4, Math.min(box.left, window.innerWidth - MENU_WIDTH - 4)) / factor,
      });
    }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) {
      return;
    }
    const dismiss = () => setOpen(false);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  const sorted = sort?.column === index ? sort : null;
  const missing =
    profile !== undefined && profile.missing > 0 && profile.count > 0
      ? Math.max(1, Math.round((profile.missing / profile.count) * 100))
      : 0;
  const act = (then: () => void) => () => {
    close();
    then();
  };

  // Drags the right edge. The pointer moves in window pixels and the layout is zoomed, as the menu's
  // placement above is.
  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = header.current?.getBoundingClientRect().width ?? 0;
    const factor = currentZoomFactor();
    const move = (moved: PointerEvent) =>
      props.onResize(Math.max(MIN_WIDTH, (startWidth + moved.clientX - startX) / factor));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const sized = width === undefined ? undefined : { width, minWidth: width, maxWidth: width };

  return (
    <th
      ref={header}
      className={['dataGrid-column', sorted ? 'is-sorted' : '', dropping ? 'is-drop-target' : '']
        .filter(Boolean)
        .join(' ')}
      style={sized}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(DRAGGED)) {
          event.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        setDropping(false);
        const from = Number(event.dataTransfer.getData(DRAGGED));
        if (!Number.isNaN(from) && from !== index) {
          event.preventDefault();
          props.onDropColumn(from);
        }
      }}
    >
      <button
        type="button"
        className="dataGrid-columnButton"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${name} (${dtype})`}
        onClick={toggle}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAGGED, String(index));
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        <span className="dataGrid-columnName">
          {name}
          {sorted && <Icon name={sorted.descending ? 'arrow-down' : 'arrow-up'} size={12} />}
        </span>
        <span className="dataGrid-dtype">{dtype}</span>
      </button>
      <Distribution profile={profile} />
      <span className="dataGrid-missing">{missing > 0 ? `${missing}% missing` : ''}</span>
      <span
        className="dataGrid-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${name}`}
        onPointerDown={startResize}
      />
      {open && (
        <div className="z-overlay z-menu dataGrid-menu" style={at}>
          <ul className="z-overlay-list" role="menu" aria-label={`Column ${name}`}>
            {queryable && (
              <>
                <MenuAction
                  icon="arrow-up"
                  label="Sort ascending"
                  onSelect={act(() => onSort({ column: index, descending: false }))}
                />
                <MenuAction
                  icon="arrow-down"
                  label="Sort descending"
                  onSelect={act(() => onSort({ column: index, descending: true }))}
                />
                {sorted && (
                  <MenuAction icon="x" label="Clear sort" onSelect={act(() => onSort(null))} />
                )}
                <MenuAction
                  icon="list-filter"
                  label="Filter this column…"
                  onSelect={act(() => onFilter(index))}
                />
              </>
            )}
            <MenuAction icon="eye-off" label="Hide column" onSelect={act(props.onHide)} />
            {props.onMoveLeft && (
              <MenuAction icon="arrow-left" label="Move left" onSelect={act(props.onMoveLeft)} />
            )}
            {props.onMoveRight && (
              <MenuAction icon="arrow-right" label="Move right" onSelect={act(props.onMoveRight)} />
            )}
            {profile !== undefined && (
              <>
                {queryable && <li className="z-overlay-separator" role="separator" />}
                <li className="z-overlay-group z-label" role="presentation">
                  {kind === 'text' || kind === 'bool' || kind === 'other'
                    ? 'Summary · commonest'
                    : 'Summary'}
                </li>
                {stats(profile).map((row, at) => (
                  <Stat key={at} label={row.label} value={row.value} />
                ))}
              </>
            )}
          </ul>
        </div>
      )}
    </th>
  );
}
