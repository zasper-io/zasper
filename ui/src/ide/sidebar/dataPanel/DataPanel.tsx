import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'react-toastify';

import {
  apiErrorMessage,
  DATAFRAMES,
  DataConnection,
  deleteConnection,
  readColumns,
  readSchema,
  SqlColumns,
  SqlSchema,
  SqlTable,
} from '@/api';
import ConfirmDialog from '@/ide/ConfirmDialog';
import IconButton from '@/ide/IconButton';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { Icon } from '@/ide/icons';
import { engineName } from '@/ide/editor/notebook/SqlCellHead';
import { sqlHeader, sqlName } from '@/ide/editor/notebook/sqlCell';
import {
  addedConnectionAtom,
  connectionsAtom,
  useLoadConnections,
  useOpenConnectionDialog,
} from '@/store/connections';
import { insertCellRequestAtom } from '@/store/editorRequests';
import { finishedRunsAtom, notebookKernelMapAtom } from '@/store/kernels';
import { fileTabsAtom } from '@/store/tabState';
import { useAskTrust, useRestricted } from '@/store/trust';
import ContextMenu from '../contextMenu/ContextMenu';
import PanelSection from '../jupyterInfoPanel/PanelSection';
import { PanelProps } from '../types';
import './DataPanel.scss';

/** What a connection's row has no width for: where it points, and whose it is. */
function describeConnection(connection: DataConnection): string[] {
  const where =
    connection.path ||
    connection.url ||
    [connection.host, connection.port].filter(Boolean).join(':') +
      (connection.database ? `/${connection.database}` : '');
  const whose = connection.scope === 'project' ? "This project's" : 'Yours, in every project';
  return [
    where || (connection.type === 'duckdb' ? 'In memory' : ''),
    connection.has_password ? `${whose} · password in the keychain` : whose,
  ].filter(Boolean);
}

/**
 * The Data panel: the data connections, down to their tables and columns, and the dataframes the kernel
 * of the notebook in front holds. A connection is read through a kernel of the panel's own, started when
 * first needed and stopped when idle, so it works with no notebook open. See docs/SQL.md.
 */
export default function DataPanel({ hidden }: PanelProps) {
  const list = useAtomValue(connectionsAtom);
  const load = useLoadConnections();
  const restricted = useRestricted();
  const askTrust = useAskTrust();
  const openConnectionDialog = useOpenConnectionDialog();
  const added = useAtomValue(addedConnectionAtom);
  const tabs = useAtomValue(fileTabsAtom);
  const kernels = useAtomValue(notebookKernelMapAtom);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    if (!hidden) {
      void load();
    }
  }, [hidden, load, refreshes]);

  const notebook = Object.values(tabs).find((tab) => tab.active && tab.type === 'notebook');
  const kernelId = notebook ? kernels[notebook.path]?.id : undefined;
  const connections = list?.connections ?? [];

  return (
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <h2 className="z-label">Data</h2>
        <IconButton icon="plus" label="Add a connection" onClick={() => openConnectionDialog()} />
        <IconButton icon="refresh-cw" label="Refresh" onClick={() => setRefreshes((n) => n + 1)} />
      </div>
      <div className="content-inner dataPanel">
        <PanelSection title="Connections" count={connections.length}>
          {connections.length === 0 ? (
            <div className="panel-section-body dataPanel-empty">
              <p className="z-note">No connections yet.</p>
              <button type="button" className="z-button" onClick={() => openConnectionDialog()}>
                Add a connection
              </button>
              <p className="z-form-help">
                Or choose <em>Dataframes</em> in a SQL cell to query the kernel&apos;s own.
              </p>
            </div>
          ) : (
            <>
              <ul className="z-list-plain dataTree">
                {connections.map((connection) => (
                  <ConnectionNode
                    key={`${connection.scope}:${connection.name}:${refreshes}`}
                    connection={connection}
                    startOpen={connection.name === added}
                    restricted={restricted}
                    onTrust={() => askTrust({ reason: 'other', what: `read ${connection.name}` })}
                    insertInto={notebook?.path}
                  />
                ))}
              </ul>
              <button
                type="button"
                className="z-button dataPanel-add"
                onClick={() => openConnectionDialog()}
              >
                <Icon name="plus" size={12} /> Add a connection
              </button>
            </>
          )}
        </PanelSection>

        <PanelSection title="Dataframes">
          {kernelId === undefined ? (
            <div className="panel-section-body">
              <p className="z-note">
                The dataframes of the notebook in front, once its kernel runs.
              </p>
            </div>
          ) : (
            <Frames
              key={`${kernelId}:${refreshes}`}
              kernelId={kernelId}
              insertInto={notebook?.path}
            />
          )}
        </PanelSection>
      </div>
    </div>
  );
}

interface ConnectionNodeProps {
  connection: DataConnection;
  /** Opened on its tables as it appears: the connection just added. */
  startOpen?: boolean;
  restricted: boolean;
  onTrust: () => void;
  insertInto?: string;
}

/** One connection: its schemas and tables, read when it is first opened. */
function ConnectionNode({
  connection,
  startOpen = false,
  restricted,
  onTrust,
  insertInto,
}: ConnectionNodeProps) {
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState<SqlSchema | null>(null);
  const [failure, setFailure] = useState('');
  const [menu, setMenu] = useState<{ xPos: number; yPos: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const setList = useSetAtom(connectionsAtom);
  const openConnectionDialog = useOpenConnectionDialog();
  const rowRef = useRef<HTMLDivElement>(null);
  const tip = useTooltip(true, rowRef);
  const edit = () => openConnectionDialog({ editing: connection });

  const read = useCallback(() => {
    readSchema(connection.name)
      .then((answer) => {
        setSchema(answer);
        setFailure(answer.error ?? '');
      })
      .catch((error) => setFailure(apiErrorMessage(error)));
  }, [connection.name]);

  useEffect(() => {
    if (startOpen && !restricted) {
      setOpen(true);
      read();
    }
    // Once, as the row appears; opening it later is the reader's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    if (restricted) {
      onTrust();
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && schema === null) {
      read();
    }
  };

  const refresh = () => {
    if (restricted) {
      onTrust();
      return;
    }
    setSchema(null);
    setFailure('');
    setOpen(true);
    read();
  };

  const remove = async () => {
    setRemoving(true);
    try {
      setList(await deleteConnection(connection.scope, connection.name));
    } catch (error) {
      toast.error(apiErrorMessage(error));
      setRemoving(false);
      setAsking(false);
    }
  };

  const menuItems = [
    { label: 'Edit', icon: 'pencil' as const, action: edit },
    { label: 'Refresh', icon: 'refresh-cw' as const, action: refresh },
    { label: 'Remove', icon: 'trash-2' as const, action: () => setAsking(true), danger: true },
  ];

  const schemas = schema?.schemas ?? [];
  return (
    <li>
      <div
        ref={rowRef}
        className="panel-row"
        {...tip.hoverProps}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ xPos: event.clientX, yPos: event.clientY });
        }}
      >
        <button type="button" className="panel-row-name" aria-expanded={open} onClick={toggle}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          <Icon name="database" />
          <span className="panel-row-label">{connection.name}</span>
        </button>
        <span className="panel-row-meta">{engineName(connection.type)}</span>
        <span className="panel-row-actions">
          <IconButton
            icon="pencil"
            className="panel-row-action"
            label={`Edit ${connection.name}`}
            size={12}
            onClick={edit}
          />
        </span>
      </div>
      <Tooltip tip={tip} label={describeConnection(connection)} />
      {menu && (
        <ContextMenu
          xPos={menu.xPos}
          yPos={menu.yPos}
          items={menuItems}
          label={connection.name}
          onClose={() => setMenu(null)}
        />
      )}
      {asking && (
        <ConfirmDialog
          title={`Remove ${connection.name}?`}
          confirmLabel="Remove"
          busyLabel="Removing…"
          busy={removing}
          onConfirm={() => void remove()}
          onCancel={() => setAsking(false)}
        >
          <div className="update-kernel-popup">
            <p>
              <strong>{connection.name}</strong>{' '}
              {connection.scope === 'project' ? (
                <>
                  is this project&apos;s, in <code>.zasper/connections.json</code>: removing it
                  removes it for everyone who pulls the change.
                </>
              ) : (
                <>
                  is yours, in <code>~/.zasper/connections.json</code>: removing it removes it from
                  every project of yours.
                </>
              )}{' '}
              {connection.has_password && 'Your password for it is deleted from the keychain. '}
              SQL cells that run on it stay as they are and say it is not set up.
            </p>
          </div>
        </ConfirmDialog>
      )}
      {open && (
        <ul className="z-list-plain dataTree-children">
          {failure !== '' && <li className="dataTree-note is-error">{failure}</li>}
          {schema === null && failure === '' && (
            <li className="dataTree-note">
              <span className="z-spinner" /> Reading {connection.name}…
            </li>
          )}
          {schemas.map((each) =>
            each.name === '' || schemas.length === 1 ? (
              each.tables.map((table) => (
                <TableNode
                  key={table.name}
                  connection={connection.name}
                  schema={each.name}
                  table={table}
                  insertInto={insertInto}
                />
              ))
            ) : (
              <SchemaNode
                key={each.name}
                connection={connection.name}
                name={each.name}
                tables={each.tables}
                startOpen={each.default === true}
                insertInto={insertInto}
              />
            )
          )}
        </ul>
      )}
    </li>
  );
}

function SchemaNode(props: {
  connection: string;
  name: string;
  tables: SqlTable[];
  startOpen: boolean;
  insertInto?: string;
}) {
  const [open, setOpen] = useState(props.startOpen);
  return (
    <li>
      <div className="panel-row">
        <button
          type="button"
          className="panel-row-name"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          <span className="panel-row-label">{props.name}</span>
        </button>
        <span className="panel-row-meta">{props.tables.length}</span>
      </div>
      {open && (
        <ul className="z-list-plain dataTree-children">
          {props.tables.map((table) => (
            <TableNode
              key={table.name}
              connection={props.connection}
              schema={props.name}
              table={table}
              insertInto={props.insertInto}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface TableNodeProps {
  connection: string;
  schema: string;
  table: SqlTable;
  /** The notebook "Query this table" adds a cell to. */
  insertInto?: string;
  kernel?: string;
}

/** A table or a dataframe: its columns when opened, and a SQL cell that reads it. */
function TableNode({ connection, schema, table, insertInto, kernel }: TableNodeProps) {
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<SqlColumns | null>(null);
  const request = useSetAtom(insertCellRequestAtom);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && columns === null) {
      readColumns(connection, schema, table.name, kernel)
        .then(setColumns)
        .catch((error) => setColumns({ columns: null, error: apiErrorMessage(error) }));
    }
  };

  const query = () => {
    if (insertInto === undefined) {
      return;
    }
    const from =
      schema && table.kind !== 'dataframe'
        ? `${sqlName(schema)}.${sqlName(table.name)}`
        : sqlName(table.name);
    request({
      path: insertInto,
      source: `${sqlHeader({ connection, out: `df_${table.name.replace(/\W/g, '_')}` })}\nSELECT *\nFROM ${from}\nLIMIT 100`,
    });
  };

  return (
    <li>
      <div className="panel-row">
        <button type="button" className="panel-row-name" aria-expanded={open} onClick={toggle}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          <Icon name="table" />
          <span className="panel-row-label">{table.name}</span>
        </button>
        {table.rows !== undefined && (
          <span className="panel-row-meta z-tabular">{table.rows.toLocaleString()}</span>
        )}
        {table.kind === 'view' && <span className="panel-row-meta">view</span>}
        {insertInto !== undefined && (
          <span className="panel-row-actions">
            <IconButton
              icon="code"
              size={12}
              className="panel-row-action"
              label={`Query ${table.name} in a new SQL cell`}
              onClick={query}
            />
          </span>
        )}
      </div>
      {open && (
        <ul className="z-list-plain dataTree-children dataTree-columns">
          {columns === null && (
            <li className="dataTree-note">
              <span className="z-spinner" />
            </li>
          )}
          {columns?.error && <li className="dataTree-note is-error">{columns.error}</li>}
          {(columns?.columns ?? []).map((column) => (
            <li key={column.name} className="panel-row">
              <span className="panel-row-label">{column.name}</span>
              <span className="panel-row-meta dataTree-type">{column.type}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The dataframes the kernel of the notebook in front holds, read again after each of its runs. */
function Frames({ kernelId, insertInto }: { kernelId: string; insertInto?: string }) {
  const runs = useAtomValue(finishedRunsAtom)[kernelId] ?? 0;
  const [answer, setAnswer] = useState<SqlSchema | null>(null);

  useEffect(() => {
    readSchema(DATAFRAMES, kernelId)
      .then(setAnswer)
      .catch((error) => setAnswer({ schemas: null, error: apiErrorMessage(error) }));
  }, [kernelId, runs, setAnswer]);

  const tables = answer?.schemas?.[0]?.tables ?? [];
  if (answer?.error) {
    return (
      <div className="panel-section-body">
        <p className="z-note">{answer.error}</p>
      </div>
    );
  }
  if (tables.length === 0) {
    return (
      <div className="panel-section-body">
        <p className="z-note">No dataframes in this notebook&apos;s kernel yet.</p>
      </div>
    );
  }
  return (
    <ul className="z-list-plain dataTree">
      {tables.map((table) => (
        <TableNode
          key={table.name}
          connection={DATAFRAMES}
          schema=""
          table={table}
          kernel={kernelId}
          insertInto={insertInto}
        />
      ))}
    </ul>
  );
}
