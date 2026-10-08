import { useState } from 'react';
import { toast } from 'react-toastify';

import {
  apiErrorMessage,
  ConnectionList,
  ConnectionScope,
  DataConnection,
  deleteConnection,
  saveConnection,
  SqlTest,
  testConnection,
} from '@/api';
import ConfirmDialog from '@/ide/ConfirmDialog';
import { Icon } from '@/ide/icons';
import { engineName } from '@/ide/editor/notebook/SqlCellHead';
import './ConnectionDialog.scss';

const DEFAULT_PORTS: Record<string, string> = {
  postgresql: '5432',
  redshift: '5439',
  mysql: '3306',
  clickhouse: '8123',
};

interface ConnectionDialogProps {
  /** The connection being edited; undefined to add one. */
  editing?: DataConnection;
  types: string[];
  onSaved: (list: ConnectionList) => void;
  onClose: () => void;
}

/**
 * Adds or edits a data connection. The password goes to the system keychain through the server and never
 * into connections.json, so a project's connections can be committed. Test connects with what the form
 * holds, saved or not, through the Data panel's kernel. See docs/SQL.md.
 */
export default function ConnectionDialog({
  editing,
  types,
  onSaved,
  onClose,
}: ConnectionDialogProps) {
  const [form, setForm] = useState<DataConnection>(
    editing ?? { name: '', type: 'postgresql', scope: 'project', port: DEFAULT_PORTS.postgresql }
  );
  // Undefined until typed: an edit that leaves it alone keeps the stored password.
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<SqlTest | { error: string; ok: false } | null>(null);

  const set = (changes: Partial<DataConnection>) => {
    setForm((current) => ({ ...current, ...changes }));
    setTest(null);
  };
  const isFile = form.type === 'sqlite' || form.type === 'duckdb';
  const isUrl = form.type === 'url';

  const runTest = async () => {
    setBusy(true);
    try {
      setTest(await testConnection(form, password));
    } catch (error) {
      setTest({ ok: false, error: apiErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await saveConnection(form, editing?.name, password));
      onClose();
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
      onSaved(await deleteConnection(editing.scope, editing.name));
      onClose();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title={
        <span className="connectionTitle">
          <Icon name="database" size={16} />
          {editing ? `Edit ${editing.name}` : 'Add a connection'}
        </span>
      }
      busy={busy}
      onCancel={onClose}
      actions={
        <>
          <button
            type="button"
            className="z-button z-button-secondary connectionTest"
            disabled={busy}
            onClick={() => void runTest()}
          >
            Test
          </button>
          {editing && (
            <button
              type="button"
              className="z-button z-button-danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove
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
          <button type="button" className="z-button" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="connectionForm">
        <label className="z-form-label" htmlFor="connection-name">
          Name
        </label>
        <input
          id="connection-name"
          className="z-field"
          value={form.name}
          placeholder="analytics"
          spellCheck={false}
          onChange={(event) => set({ name: event.target.value })}
        />

        <label className="z-form-label" htmlFor="connection-type">
          Type
        </label>
        <div className="z-select">
          <select
            id="connection-type"
            value={form.type}
            onChange={(event) =>
              set({ type: event.target.value, port: DEFAULT_PORTS[event.target.value] ?? '' })
            }
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {type === 'url' ? 'Other (SQLAlchemy URL)' : engineName(type)}
              </option>
            ))}
          </select>
        </div>

        {isFile && (
          <>
            <label className="z-form-label" htmlFor="connection-path">
              File
            </label>
            <input
              id="connection-path"
              className="z-field"
              value={form.path ?? ''}
              placeholder={form.type === 'duckdb' ? 'Empty for one in memory' : 'data/local.db'}
              onChange={(event) => set({ path: event.target.value })}
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
              className="z-field"
              value={form.url ?? ''}
              placeholder="trino://me@host:8080/catalog"
              spellCheck={false}
              onChange={(event) => set({ url: event.target.value })}
            />
          </>
        )}

        {!isFile && !isUrl && (
          <>
            <label className="z-form-label" htmlFor="connection-host">
              Host
            </label>
            <div className="connectionHost">
              <input
                id="connection-host"
                className="z-field"
                value={form.host ?? ''}
                onChange={(event) => set({ host: event.target.value })}
              />
              <input
                className="z-field connectionPort"
                aria-label="Port"
                value={form.port ?? ''}
                onChange={(event) => set({ port: event.target.value })}
              />
            </div>
            <label className="z-form-label" htmlFor="connection-database">
              Database
            </label>
            <input
              id="connection-database"
              className="z-field"
              value={form.database ?? ''}
              onChange={(event) => set({ database: event.target.value })}
            />
            <label className="z-form-label" htmlFor="connection-user">
              User
            </label>
            <input
              id="connection-user"
              className="z-field"
              value={form.user ?? ''}
              onChange={(event) => set({ user: event.target.value })}
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
              onChange={(event) => setPassword(event.target.value)}
            />
            <span />
            <p className="z-form-help connectionKeychain">
              <Icon name="key-round" size={12} /> Kept in the system keychain, never in a file.
            </p>
          </>
        )}

        <span className="z-form-label">Kept for</span>
        <div className="connectionScope">
          {(['project', 'user'] as ConnectionScope[]).map((scope) => (
            <label key={scope} className="z-checkbox">
              <input
                type="radio"
                name="connection-scope"
                checked={form.scope === scope}
                disabled={editing !== undefined}
                onChange={() => set({ scope })}
              />
              {scope === 'project' ? 'This project' : 'All my projects'}
            </label>
          ))}
        </div>
      </div>
      {test !== null && (
        <p
          className={test.ok ? 'connectionResult is-ok' : 'connectionResult is-error'}
          role="status"
        >
          <Icon name={test.ok ? 'circle-check' : 'circle-alert'} size={12} />
          {test.ok
            ? `Connected · ${'version' in test ? test.version : ''}${'ms' in test && test.ms !== undefined ? ` · ${test.ms} ms` : ''}`
            : test.error}
        </p>
      )}
    </ConfirmDialog>
  );
}
