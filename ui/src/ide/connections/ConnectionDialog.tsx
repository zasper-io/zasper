import { useEffect, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'react-toastify';

import {
  apiErrorMessage,
  DatabaseFile,
  DataConnection,
  deleteConnection,
  installIntoKernel,
  listDatabaseFiles,
  saveConnection,
  testConnection,
} from '@/api';
import ConfirmDialog from '@/ide/ConfirmDialog';
import { DatabaseLogo, Icon } from '@/ide/icons';
import { engineName } from '@/ide/editor/notebook/SqlCellHead';
import { formatSize } from '@/ide/sidebar/fileBrowser/entryDetails';
import {
  addedConnectionAtom,
  connectionDialogAtom,
  ConnectionDialogRequest,
  connectionsAtom,
} from '@/store/connections';
import { useAskTrust, useRestricted } from '@/store/trust';
import {
  ConnectionFields,
  DEFAULT_PORTS,
  parseConnectionString,
  suggestName,
} from './connectionString';
import './ConnectionDialog.scss';

const ENGINES = [
  'postgresql',
  'mysql',
  'sqlite',
  'duckdb',
  'snowflake',
  'bigquery',
  'redshift',
  'databricks',
  'clickhouse',
  'url',
];

/** The project's database files offered at most, those already a connection left out. */
const MAX_FILES = 5;

/** What Connect has to say, below the form. */
type Outcome =
  | { kind: 'connecting' }
  | { kind: 'refused'; error: string }
  | { kind: 'missing'; name: string; kernel?: string }
  | { kind: 'untrusted' }
  | { kind: 'failed'; error: string };

function engineLabel(engine: string): string {
  return engine === 'url' ? 'Other URL' : engineName(engine);
}

/** The one dialog the IDE draws, for whichever way in asked for it. */
export function ConnectionDialogHost() {
  const [request, setRequest] = useAtom(connectionDialogAtom);
  return request === null ? null : (
    <ConnectionDialog {...request} onClose={() => setRequest(null)} />
  );
}

interface ConnectionDialogProps extends ConnectionDialogRequest {
  onClose: () => void;
}

/**
 * Adds a connection, from a pasted URL, an engine or a database file in the project, or edits one.
 * Connect tests the connection in a kernel, then saves it; the password goes to the system keychain
 * through the server and never into connections.json, so a project's connections can be committed.
 * See docs/SQL.md.
 */
export default function ConnectionDialog({ editing, onAdded, onClose }: ConnectionDialogProps) {
  const [list, setList] = useAtom(connectionsAtom);
  const setAdded = useSetAtom(addedConnectionAtom);
  const restricted = useRestricted();
  const askTrust = useAskTrust();

  const [step, setStep] = useState<'choose' | 'form'>(editing ? 'form' : 'choose');
  const [fields, setFields] = useState<ConnectionFields>(
    editing ?? { type: 'postgresql', port: DEFAULT_PORTS.postgresql }
  );
  const [engine, setEngine] = useState(editing?.type ?? 'postgresql');
  const [fromPaste, setFromPaste] = useState(false);
  const [name, setName] = useState(editing?.name ?? '');
  // A name nobody has typed follows what it names.
  const [nameTyped, setNameTyped] = useState(editing !== undefined);
  const [shared, setShared] = useState(editing ? editing.scope === 'project' : true);
  // Undefined until typed or pasted: an edit that leaves it alone keeps the stored password.
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState(false);
  const [files, setFiles] = useState<DatabaseFile[]>([]);

  const connections = list?.connections ?? [];
  const taken = connections.map((c) => c.name).filter((n) => n !== editing?.name);
  const effectiveName = nameTyped ? name : suggestName(fields, taken);
  const isFile = fields.type === 'sqlite' || fields.type === 'duckdb';
  const isUrl = fields.type === 'url';

  useEffect(() => {
    if (editing === undefined) {
      listDatabaseFiles()
        .then(setFiles)
        .catch(() => setFiles([]));
    }
  }, [editing]);
  // Trusted from the notice: Connect can go ahead now.
  useEffect(() => {
    if (!restricted) {
      setOutcome((current) => (current?.kind === 'untrusted' ? null : current));
    }
  }, [restricted]);
  const offered = files
    .filter((file) => !connections.some((c) => c.path === file.path))
    .slice(0, MAX_FILES);

  const change = (changes: Partial<ConnectionFields>) => {
    setFields((current) => ({ ...current, ...changes }));
    setOutcome(null);
  };

  const choose = (type: string) => {
    setFields({ type, port: DEFAULT_PORTS[type] });
    setEngine(type);
    setFromPaste(false);
    setPassword(undefined);
    setStep('form');
  };

  const readPasted = (text: string) => {
    const parsed = parseConnectionString(text);
    if (parsed === null) {
      setPasteError(text.trim() !== '');
      return;
    }
    setFields(parsed.fields);
    setEngine(parsed.engine);
    setPassword(parsed.password);
    setFromPaste(true);
    setStep('form');
  };

  const finish = (saved: DataConnection) => {
    if (editing === undefined) {
      setAdded(saved.name);
      onAdded?.(saved.name);
    }
    onClose();
  };

  const save = async (connection: DataConnection) => {
    setBusy(true);
    try {
      setList(await saveConnection(connection, editing?.name, password));
      finish(connection);
      return true;
    } catch (error) {
      setOutcome({ kind: 'failed', error: apiErrorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const connection = (): DataConnection => ({
    ...fields,
    name: effectiveName,
    scope: shared ? 'project' : 'user',
  });

  const connect = async () => {
    if (restricted) {
      setOutcome({ kind: 'untrusted' });
      return;
    }
    const wanted = connection();
    setBusy(true);
    setOutcome({ kind: 'connecting' });
    try {
      const answer = await testConnection(wanted, password);
      if (answer.ok) {
        setBusy(false);
        if (await save(wanted)) {
          toast.success(
            `Connected to ${wanted.name}${answer.ms !== undefined ? ` · ${answer.ms} ms` : ''}`
          );
        }
        return;
      }
      setOutcome(
        answer.missing
          ? { kind: 'missing', name: answer.missing, kernel: answer.kernel }
          : { kind: 'refused', error: answer.error ?? `${wanted.name} did not answer.` }
      );
    } catch (error) {
      setOutcome({ kind: 'refused', error: apiErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const installAndConnect = async (missing: string, kernel: string) => {
    setBusy(true);
    try {
      const installed = await installIntoKernel(kernel, missing);
      if (!installed.ok) {
        setOutcome({ kind: 'refused', error: `${missing} could not be installed.` });
        return;
      }
    } catch (error) {
      setOutcome({ kind: 'refused', error: apiErrorMessage(error) });
      return;
    } finally {
      setBusy(false);
    }
    await connect();
  };

  const addFile = async (file: DatabaseFile) => {
    const added: DataConnection = {
      name: suggestName({ type: file.type, path: file.path }, taken),
      type: file.type,
      path: file.path,
      scope: 'project',
    };
    setBusy(true);
    try {
      setList(await saveConnection(added, undefined, undefined));
      toast.success(`Added ${added.name}`);
      finish(added);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (editing === undefined) {
      return;
    }
    setBusy(true);
    try {
      setList(await deleteConnection(editing.scope, editing.name));
      onClose();
    } catch (error) {
      setOutcome({ kind: 'failed', error: apiErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const title = (
    <span className="connectionDialog-title">
      <Icon name="database" size={16} />
      {editing ? `Edit ${editing.name}` : 'Add a connection'}
    </span>
  );

  if (step === 'choose') {
    return (
      <ConfirmDialog
        title={title}
        busy={busy}
        onCancel={onClose}
        actions={
          <button type="button" className="z-button z-button-secondary" onClick={onClose}>
            Cancel
          </button>
        }
      >
        <div className="connectionDialog-body">
          <label className="z-form-label" htmlFor="connection-paste">
            Paste a connection string
          </label>
          <input
            id="connection-paste"
            className="z-field connectionDialog-url"
            value={pasted}
            placeholder="postgresql://me:password@db.internal:5432/analytics"
            spellCheck={false}
            autoFocus
            onChange={(event) => {
              setPasted(event.target.value);
              setPasteError(false);
            }}
            onPaste={(event) => readPasted(event.clipboardData.getData('text'))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                readPasted(pasted);
              }
            }}
          />
          <p className={pasteError ? 'z-form-help is-error' : 'z-form-help'}>
            {pasteError
              ? 'Not a connection string Zasper can read, such as postgresql://me@host/db.'
              : 'Any SQLAlchemy URL. A password in it goes to the keychain, never into a file.'}
          </p>

          <div className="connectionDialog-or">
            <span>or choose the database</span>
          </div>

          <div className="connectionDialog-engines">
            {(list?.types ?? ENGINES).map((type) => (
              <button
                key={type}
                type="button"
                className="connectionDialog-engine"
                onClick={() => choose(type)}
              >
                <DatabaseLogo type={type} />
                {engineLabel(type)}
              </button>
            ))}
          </div>

          {offered.length > 0 && (
            <>
              <div className="z-label connectionDialog-filesTitle">
                Database files in this project
              </div>
              <ul className="z-list-plain connectionDialog-files">
                {offered.map((file) => (
                  <li key={file.path} className="panel-row">
                    <Icon name="database" size={12} />
                    <span className="panel-row-label">{file.path}</span>
                    <span className="panel-row-meta">
                      {engineName(file.type)} · {formatSize(file.size)}
                    </span>
                    <button
                      type="button"
                      className="z-button z-button-secondary connectionDialog-fileAdd"
                      aria-label={`Add ${file.path}`}
                      disabled={busy}
                      onClick={() => void addFile(file)}
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </ConfirmDialog>
    );
  }

  const saveAnyway =
    outcome?.kind === 'refused' || outcome?.kind === 'missing'
      ? 'Save anyway'
      : outcome?.kind === 'untrusted'
        ? 'Save without connecting'
        : null;

  return (
    <ConfirmDialog
      title={title}
      busy={busy}
      onCancel={onClose}
      actions={
        <>
          {saveAnyway !== null ? (
            <button
              type="button"
              className="z-button z-button-secondary connectionDialog-left"
              disabled={busy}
              onClick={() => void save(connection())}
            >
              {saveAnyway}
            </button>
          ) : editing ? (
            <button
              type="button"
              className="z-button z-button-danger connectionDialog-left"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              className="z-button z-button-secondary connectionDialog-left"
              disabled={busy}
              onClick={() => {
                setOutcome(null);
                setStep('choose');
              }}
            >
              <Icon name="arrow-left" size={12} /> Back
            </button>
          )}
          <button
            type="button"
            className="z-button z-button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="z-button"
            disabled={
              busy || outcome?.kind === 'missing' || (outcome?.kind === 'untrusted' && restricted)
            }
            onClick={() => void connect()}
          >
            Connect
          </button>
        </>
      }
    >
      <div className="connectionDialog-source">
        <DatabaseLogo type={engine} size={16} />
        <span>
          {engineLabel(engine)}
          {fromPaste && <span className="connectionDialog-from"> · from the pasted URL</span>}
        </span>
      </div>
      <div className="connectionDialog-form">
        {isFile && (
          <>
            <label className="z-form-label" htmlFor="connection-path">
              File
            </label>
            <input
              id="connection-path"
              className="z-field"
              value={fields.path ?? ''}
              placeholder={fields.type === 'duckdb' ? 'Empty for one in memory' : 'data/local.db'}
              onChange={(event) => change({ path: event.target.value })}
            />
          </>
        )}

        {isUrl && (
          <>
            <label className="z-form-label" htmlFor="connection-url">
              URL
            </label>
            <input
              id="connection-url"
              className="z-field connectionDialog-url"
              value={fields.url ?? ''}
              placeholder="trino://me@host:8080/catalog"
              spellCheck={false}
              onChange={(event) => change({ url: event.target.value })}
            />
          </>
        )}

        {!isFile && !isUrl && (
          <>
            <label className="z-form-label" htmlFor="connection-host">
              Host
            </label>
            <div className="connectionDialog-host">
              <input
                id="connection-host"
                className="z-field"
                value={fields.host ?? ''}
                autoFocus={!fromPaste && editing === undefined}
                onChange={(event) => change({ host: event.target.value })}
              />
              <input
                className="z-field connectionDialog-port"
                aria-label="Port"
                value={fields.port ?? ''}
                onChange={(event) => change({ port: event.target.value })}
              />
            </div>
            <label className="z-form-label" htmlFor="connection-database">
              Database
            </label>
            <input
              id="connection-database"
              className="z-field"
              value={fields.database ?? ''}
              onChange={(event) => change({ database: event.target.value })}
            />
            <label className="z-form-label" htmlFor="connection-user">
              User
            </label>
            <input
              id="connection-user"
              className="z-field"
              value={fields.user ?? ''}
              onChange={(event) => change({ user: event.target.value })}
            />
          </>
        )}

        {!isFile && (
          <>
            <label className="z-form-label" htmlFor="connection-password">
              Password
            </label>
            <input
              id="connection-password"
              className="z-field"
              type="password"
              value={password ?? ''}
              placeholder={editing?.has_password ? 'Kept, unchanged' : ''}
              onChange={(event) => {
                setPassword(event.target.value);
                setOutcome(null);
              }}
            />
            <span />
            <p className="z-form-help connectionDialog-keychain">
              <Icon name="key-round" size={12} />
              {fromPaste && password ? 'From the URL. ' : ''}Kept in the system keychain, never in a
              file.
            </p>
          </>
        )}

        <label className="z-form-label" htmlFor="connection-name">
          Name
        </label>
        <input
          id="connection-name"
          className="z-field"
          value={effectiveName}
          spellCheck={false}
          onChange={(event) => {
            setName(event.target.value);
            setNameTyped(true);
            setOutcome(null);
          }}
        />
        <span />
        <p className="z-form-help">What a SQL cell calls it.</p>

        <span />
        <div>
          <label className="z-checkbox">
            <input
              type="checkbox"
              checked={shared}
              disabled={editing !== undefined}
              onChange={(event) => setShared(event.target.checked)}
            />
            Share with this project
          </label>
          <p className="z-form-help">
            {shared
              ? 'In .zasper/connections.json, committed with the notebook. Each person adds their own password.'
              : 'In ~/.zasper/connections.json, yours in every project.'}
          </p>
        </div>
      </div>

      {outcome?.kind === 'connecting' && (
        <p className="z-note connectionDialog-outcome" role="status">
          <span className="z-spinner" /> Connecting to {fields.host || fields.path || effectiveName}
          …
        </p>
      )}
      {(outcome?.kind === 'refused' || outcome?.kind === 'failed') && (
        <div className="z-notice z-notice-error connectionDialog-outcome" role="alert">
          <Icon name="circle-alert" size={12} />
          <p>{outcome.error}</p>
        </div>
      )}
      {outcome?.kind === 'missing' && (
        <div className="z-notice connectionDialog-outcome" role="status">
          <Icon name="info" size={12} />
          <p>
            <code>{outcome.name}</code> is not installed in the kernel that would run the query.
          </p>
          {outcome.kernel !== undefined && (
            <button
              type="button"
              className="z-button z-button-secondary z-notice-action"
              disabled={busy}
              onClick={() => void installAndConnect(outcome.name, outcome.kernel ?? '')}
            >
              {busy ? `Installing ${outcome.name}…` : 'Install and connect'}
            </button>
          )}
        </div>
      )}
      {outcome?.kind === 'untrusted' && (
        <div className="z-notice connectionDialog-outcome" role="status">
          <Icon name="shield" size={12} />
          <p>Connecting runs code in a kernel, and this folder is not trusted.</p>
          <button
            type="button"
            className="z-button z-button-secondary z-notice-action"
            onClick={() => askTrust({ reason: 'other', what: `connect to ${effectiveName}` })}
          >
            Trust…
          </button>
        </div>
      )}
    </ConfirmDialog>
  );
}
