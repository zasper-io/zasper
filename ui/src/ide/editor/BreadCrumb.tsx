import React, { useEffect, useRef, useState } from 'react';

import { ContentEntry, getDirectory } from '@/api';
import { useDismissOnEscape, useDismissOnPressOutside } from '@/ide/overlays';
import FileMark from '@/ide/icons/FileMark';
import { DocumentSymbol, kindGlyph, symbolSiblings } from '@/lsp/symbols';
import { baseName } from '@/paths';
import { useTabActions } from '@/store/tabActions';
import './Editor.scss';

interface BreadCrumbProps {
  path: string;
  /** The symbols the cursor is inside, outermost first. */
  trail?: DocumentSymbol[];
  /** Everything the file declares, so a crumb can offer what sits beside it. */
  symbols?: DocumentSymbol[];
  /** Puts the cursor on a line of this file, for a symbol chosen from a crumb's menu. */
  onGoTo?: (line: number, character: number) => void;
}

/** Which crumb's menu is open, and where that crumb is — a menu hangs from the crumb it belongs to. */
type Open =
  | { kind: 'folder'; path: string; left: number }
  | { kind: 'symbol'; depth: number; left: number }
  | null;

/**
 * The trail above the editor: the project, the folders, the file, and the symbol the
 * cursor is in. Every level opens what sits beside it: a folder its contents, a symbol its siblings.
 */
export default function BreadCrumb(props: BreadCrumbProps) {
  // Paths are relative to the project root, and a top-level file splits to a single segment
  // while a nested one splits to an empty leading segment. Lead with `root` in both cases.
  const segments = props.path.split('/').filter((segment) => segment !== '');
  const folders = segments.slice(0, -1);
  const trail = props.trail ?? [];
  const [open, setOpen] = useState<Open>(null);
  const [listing, setListing] = useState<ContentEntry[]>([]);
  const bar = useRef<HTMLDivElement>(null);
  const { openTab } = useTabActions();

  useDismissOnEscape(() => setOpen(null), open !== null);
  useDismissOnPressOutside(bar, () => setOpen(null), open !== null);

  // A folder's contents are read when its crumb is pressed, not before: the bar is drawn above every
  // editor, and a listing per open file is a request nobody asked for.
  useEffect(() => {
    if (open === null || open.kind !== 'folder') {
      return;
    }
    let live = true;
    setListing([]);
    getDirectory(open.path)
      .then((entry) => {
        if (live) {
          setListing(entry.content ?? []);
        }
      })
      .catch(() => setListing([]));
    return () => {
      live = false;
    };
  }, [open]);

  /** Where a crumb sits in the bar, so its menu hangs from it rather than from the bar's left edge. */
  const leftOf = (button: HTMLElement) =>
    button.getBoundingClientRect().left - (bar.current?.getBoundingClientRect().left ?? 0);

  const crumbs: { key: string; label: string; press: (left: number) => void }[] = [
    {
      key: 'root',
      label: 'Project Root',
      press: (left) => setOpen({ kind: 'folder', path: '', left }),
    },
    ...folders.map((folder, index) => {
      const path = segments.slice(0, index + 1).join('/');
      return {
        key: path,
        label: folder,
        press: (left: number) => setOpen({ kind: 'folder', path, left }),
      };
    }),
    {
      key: props.path,
      label: baseName(props.path),
      // The file's own crumb offers what sits beside it, which is its folder's listing.
      press: (left: number) => setOpen({ kind: 'folder', path: folders.join('/'), left }),
    },
    ...trail.map((symbol, depth) => ({
      key: `symbol:${symbol.name}:${depth}`,
      label: symbol.name,
      press: (left: number) => setOpen({ kind: 'symbol', depth, left }),
    })),
  ];

  const siblings =
    open?.kind === 'symbol' ? symbolSiblings(props.symbols ?? [], trail, open.depth) : [];

  return (
    <div className="breadcrumbArea" ref={bar}>
      {/* The label stays: it is what names the trail to a screen reader, and it is the one thing
          here that was never Bootstrap's. The two class names were — see Editor.scss. */}
      <nav aria-label="breadcrumb">
        <ol>
          {crumbs.map((crumb) => (
            <li key={crumb.key}>
              <button
                type="button"
                className="crumb-button"
                aria-haspopup="menu"
                aria-expanded={
                  (open?.kind === 'folder' && open.path === crumb.key) ||
                  (open?.kind === 'symbol' &&
                    `symbol:${trail[open.depth]?.name}:${open.depth}` === crumb.key)
                }
                onClick={(event) =>
                  open === null ? crumb.press(leftOf(event.currentTarget)) : setOpen(null)
                }
              >
                {crumb.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {open?.kind === 'folder' && (
        <div
          className="z-overlay z-menu crumb-menu"
          style={{ left: open.left }}
          role="menu"
          aria-label="Folder"
        >
          <div className="z-overlay-list">
            {listing.length === 0 ? (
              <p className="z-note crumb-menu-empty">Nothing here.</p>
            ) : (
              listing.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  role="menuitem"
                  className="panel-row"
                  onClick={() => {
                    if (entry.type === 'directory') {
                      // The menu stays where it was: it is still the same crumb being explored.
                      setOpen({ kind: 'folder', path: entry.path, left: open.left });
                      return;
                    }
                    setOpen(null);
                    openTab({
                      name: entry.name,
                      path: entry.path,
                      type: entry.type === 'notebook' ? 'notebook' : 'file',
                    });
                  }}
                >
                  <FileMark name={entry.type === 'directory' ? '' : entry.name} />
                  <span className="panel-row-name">
                    <span className="panel-row-label">{entry.name}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {open?.kind === 'symbol' && (
        <div
          className="z-overlay z-menu crumb-menu"
          style={{ left: open.left }}
          role="menu"
          aria-label="Symbols"
        >
          <div className="z-overlay-list">
            {siblings.length === 0 ? (
              <p className="z-note crumb-menu-empty">No symbols here.</p>
            ) : (
              siblings.map((symbol) => (
                <button
                  key={`${symbol.name}:${symbol.line}`}
                  type="button"
                  role="menuitem"
                  className={
                    symbol.name === trail[open.depth]?.name ? 'panel-row is-selected' : 'panel-row'
                  }
                  onClick={() => {
                    setOpen(null);
                    props.onGoTo?.(symbol.line, symbol.character);
                  }}
                >
                  <span className="crumb-kind">{kindGlyph(symbol.kind)}</span>
                  <span className="panel-row-name">
                    <span className="panel-row-label">{symbol.name}</span>
                    {symbol.detail !== undefined && symbol.detail !== '' && (
                      <span className="panel-row-meta">{symbol.detail}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
