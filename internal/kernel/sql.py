"""
Zasper's SQL cells, inside a Python kernel: the %%zasper_sql magic, the connections the server hands over
for a query, a schema reader for the Data panel, and DuckDB over the kernel's own dataframes.

Loaded as the module `_zasper_sql`, never into the user's namespace. A connection's password arrives from
the server only when it is about to be used and is kept in this module, never in a variable a cell can
list. SQLite and DuckDB need nothing but their own module; every other database goes through SQLAlchemy
and the driver installed in this kernel's environment.
"""

import base64
import json
import os
import shlex
import sys
import threading
import time
from collections import OrderedDict

# Imported, not taken from builtins: IPython puts get_ipython there only while a cell runs, and the
# server's questions are answered outside one.
from IPython import get_ipython

MIME = "application/vnd.zasper.sql+json"
DEFAULT_LIMIT = 1000
CACHE_SECONDS = 3600
MAX_CACHED = 20
# How long counting a result for Load all may take. On a warehouse a count is the query run again.
COUNT_SECONDS = 10
DATAFRAMES = "dataframes"
# Answered in milliseconds, and changed by the notebook itself: a cached answer would only be a stale one.
UNCACHED = {DATAFRAMES, "sqlite", "duckdb"}

# Kept across reloads of this module: the server execs the source again on every request.
_connections = globals().get("_connections", {})
_engines = globals().get("_engines", {})
_cache = globals().get("_cache", OrderedDict())

# What to install when a driver is missing, by the module SQLAlchemy failed to import.
_PACKAGES = {
    "psycopg": "psycopg[binary]",
    "psycopg2": "psycopg2-binary",
    "pymysql": "pymysql",
    "MySQLdb": "mysqlclient",
    "snowflake": "snowflake-sqlalchemy",
    "sqlalchemy_bigquery": "sqlalchemy-bigquery",
    "databricks": "databricks-sqlalchemy",
    "clickhouse_sqlalchemy": "clickhouse-sqlalchemy",
    "sqlalchemy_redshift": "sqlalchemy-redshift",
    "duckdb": "duckdb",
    "sqlalchemy": "sqlalchemy",
    "pandas": "pandas",
}


def _encode(answer):
    return base64.b64encode(json.dumps(answer, default=str).encode()).decode()


class SqlError(Exception):
    """A query that failed, said in the database's own words without a Python traceback."""

    def __init__(self, message, missing=None):
        super().__init__(message)
        self.missing = missing

    def _render_traceback_(self):
        return [str(self)]


def _missing(error):
    """The package to install for a driver that failed to import, said so the UI can offer it."""
    name = getattr(error, "name", None)
    if not name:
        text = str(error)
        name = text.split("'")[1] if text.count("'") >= 2 else text
    root = name.split(".")[0]
    package = _PACKAGES.get(root, root)
    return SqlError(f"{package} is not installed in {sys.executable}", missing=package)


def register(name, spec):
    """Takes a connection from the server: its type, where it is, and its password if it has one."""
    spec = json.loads(spec)
    if _connections.get(name) != spec:
        _connections[name] = spec
        engine = _engines.pop(name, None)
        if engine is not None:
            try:
                engine.dispose()
            except Exception:
                pass
    return _encode(True)


def _url(spec):
    """A SQLAlchemy URL for the connection, built so that a password with an @ in it survives."""
    from sqlalchemy.engine import URL, make_url

    if spec.get("url"):
        url = make_url(spec["url"])
        return url.set(password=spec["password"]) if spec.get("password") else url

    drivers = {"postgresql": "postgresql+psycopg", "mysql": "mysql+pymysql"}
    return URL.create(
        drivers.get(spec["type"], spec["type"]),
        username=spec.get("user") or None,
        password=spec.get("password") or None,
        host=spec.get("host") or None,
        port=int(spec["port"]) if spec.get("port") else None,
        database=spec.get("database") or None,
    )


def _frames():
    """The kernel's dataframes, by name: what a query on Dataframes can read."""
    namespace = get_ipython().user_ns
    found = {}
    for key, value in namespace.items():
        if key.startswith("_"):
            continue
        module = type(value).__module__ or ""
        if type(value).__name__ == "DataFrame" and module.split(".")[0] in ("pandas", "polars"):
            found[key] = value
    return found


def _frame_from(columns, rows):
    import pandas as pd

    return pd.DataFrame.from_records(list(rows), columns=list(columns))


def _run(name, query, limit, within=None):
    """
    Runs query on the connection called name and answers a dataframe and whether rows were left. A query
    still running after within seconds is cancelled, and raises _TooLong.
    """
    take = None if limit is None else limit + 1
    if name == DATAFRAMES:
        return _interruptible(lambda hold: _run_duckdb(None, query, take, limit, hold), "DuckDB", within)
    spec = _connections.get(name) or _from_files(name)
    if spec is None:
        raise SqlError(f"There is no connection called {name}.")
    kind = spec["type"]
    if kind == "sqlite":
        return _interruptible(lambda hold: _run_sqlite(spec["path"], query, take, limit, hold), name, within)
    if kind == "duckdb":
        path = spec.get("path") or ":memory:"
        return _interruptible(lambda hold: _run_duckdb(path, query, take, limit, hold), name, within)
    try:
        import sqlalchemy
    except ImportError as error:
        raise _missing(error) from None
    engine = _engines.get(name)
    if engine is None:
        try:
            engine = sqlalchemy.create_engine(_url(spec))
        except ImportError as error:
            raise _missing(error) from None
        _engines[name] = engine
    return _interruptible(lambda hold: _run_sqlalchemy(engine, query, take, limit, hold), name, within)


class _TooLong(Exception):
    """A query cancelled for running past the time it was given."""


def _interruptible(work, what, within=None):
    """
    Runs work on a thread of its own, so that interrupting the kernel reaches a query still running.
    ipykernel interrupts with SIGINT, which Python acts on only between bytecodes: a query inside a
    driver's C code ran to its end first, 11.9 s for a SQLite query interrupted at 1 s. work is handed
    hold, which it calls with the function that cancels its query once it has a connection, or None for
    a driver that has no way to.
    """
    outcome = {}
    cancels = []

    def run():
        try:
            outcome["value"] = work(cancels.append)
        except BaseException as error:
            outcome["error"] = error

    thread = threading.Thread(target=run, name="zasper-sql", daemon=True)
    thread.start()
    deadline = None if within is None else time.monotonic() + within
    try:
        while thread.is_alive():
            thread.join(0.1)
            if deadline is not None and time.monotonic() > deadline and thread.is_alive():
                if cancels and cancels[0] is not None:
                    try:
                        cancels[0]()
                    except Exception:
                        pass
                raise _TooLong()
    except KeyboardInterrupt:
        if not cancels:
            raise SqlError(f"Stopped before {what} answered.") from None
        if cancels[0] is None:
            raise SqlError(
                f"Stopped waiting. The driver for {what} cannot cancel a query, so the database may still be running it."
            ) from None
        try:
            cancels[0]()
        except Exception:
            pass
        thread.join(10)
        raise SqlError(f"Stopped. {what} was told to cancel the query.") from None
    if "error" in outcome:
        raise outcome["error"]
    return outcome["value"]


def _run_sqlite(path, query, take, limit, hold):
    import sqlite3

    connection = sqlite3.connect(path)
    hold(connection.interrupt)
    try:
        cursor = connection.execute(query)
        columns = [d[0] for d in cursor.description or []]
        rows = cursor.fetchall() if take is None else cursor.fetchmany(take)
    except sqlite3.Error as error:
        raise SqlError(str(error)) from None
    finally:
        connection.close()
    return _trimmed(columns, rows, limit)


def _run_duckdb(path, query, take, limit, hold):
    try:
        import duckdb
    except ImportError as error:
        raise _missing(error) from None
    connection = duckdb.connect(path or ":memory:")
    hold(connection.interrupt)
    try:
        if path is None:
            # Registered as views, not copied: DuckDB reads pandas and polars frames where they are.
            for frame_name, frame in _frames().items():
                connection.register(frame_name, frame)
        cursor = connection.execute(query)
        columns = [d[0] for d in cursor.description or []]
        rows = cursor.fetchall() if take is None else cursor.fetchmany(take)
    except duckdb.Error as error:
        raise SqlError(str(error)) from None
    finally:
        connection.close()
    return _trimmed(columns, rows, limit)


def _canceller(dbapi_connection):
    """How a DBAPI connection stops the query it is running, or None. psycopg 3 and psycopg2 have one;
    pymysql does not."""
    for name in ("cancel_safe", "cancel"):
        cancel = getattr(dbapi_connection, name, None)
        if callable(cancel):
            return cancel
    return None


def _run_sqlalchemy(engine, query, take, limit, hold):
    import sqlalchemy
    from sqlalchemy import text

    try:
        with engine.connect() as connection:
            hold(_canceller(connection.connection.dbapi_connection))
            result = connection.execute(text(query))
            if not result.returns_rows:
                connection.commit()
                return _frame_from(["rows affected"], [(result.rowcount,)]), False
            columns = list(result.keys())
            rows = result.fetchall() if take is None else result.fetchmany(take)
    except ImportError as error:
        raise _missing(error) from None
    except sqlalchemy.exc.DBAPIError as error:
        raise SqlError(str(error.orig).strip()) from None
    except sqlalchemy.exc.SQLAlchemyError as error:
        raise SqlError(str(error).strip()) from None
    return _trimmed(columns, rows, limit)


def _trimmed(columns, rows, limit):
    more = limit is not None and len(rows) > limit
    if more:
        rows = rows[:limit]
    return _frame_from(columns, rows), more


def _from_files(name):
    """
    A connection read from connections.json, for a kernel the server has not handed it to: JupyterLab
    running a notebook Zasper wrote. The password is then read from the environment, as
    ZASPER_SQL_<NAME>_PASSWORD, or the keyring package when it is installed.
    """
    for path in (os.path.join(".zasper", "connections.json"), os.path.expanduser("~/.zasper/connections.json")):
        try:
            with open(path) as handle:
                entries = json.load(handle)
        except (OSError, ValueError):
            continue
        for entry in entries:
            if entry.get("name") == name:
                spec = dict(entry)
                key = "ZASPER_SQL_" + "".join(c if c.isalnum() else "_" for c in name).upper() + "_PASSWORD"
                spec["password"] = os.environ.get(key)
                if spec["password"] is None:
                    try:
                        import keyring

                        spec["password"] = keyring.get_password("zasper", "connection:" + name)
                    except Exception:
                        pass
                return spec
    return None


def _parse(line):
    words = shlex.split(line)
    options = {"connection": None, "out": "_", "limit": DEFAULT_LIMIT, "fresh": False}
    position = 0
    while position < len(words):
        word = words[position]
        if word == "--out" and position + 1 < len(words):
            options["out"] = words[position + 1]
            position += 2
        elif word == "--limit" and position + 1 < len(words):
            value = words[position + 1]
            options["limit"] = None if value in ("none", "all", "0") else int(value)
            position += 2
        elif word == "--fresh":
            options["fresh"] = True
            position += 1
        elif options["connection"] is None:
            options["connection"] = word
            position += 1
        else:
            raise SqlError(f"%%zasper_sql does not understand {word!r}")
    if options["connection"] is None:
        raise SqlError("%%zasper_sql needs a connection: %%zasper_sql <connection> --out <name>")
    if not options["out"].isidentifier():
        raise SqlError(f"{options['out']!r} is not a name a dataframe can have")
    return options


def zasper_sql(line, cell):
    """%%zasper_sql <connection> [--out name] [--limit n|none] [--fresh]: runs the cell as SQL."""
    from IPython.display import display

    options = _parse(line)
    name, query, limit = options["connection"], cell.strip(), options["limit"]
    key = (name, query, limit)
    kind = name if name == DATAFRAMES else (_connections.get(name) or _from_files(name) or {}).get("type")
    cached = None if kind in UNCACHED else _cache.get(key)
    started = time.monotonic()
    if cached is not None and not options["fresh"] and time.time() - cached[2] < CACHE_SECONDS:
        frame, more, ran_at = cached
        from_cache = True
    else:
        frame, more = _run(name, query, limit)
        ran_at = time.time()
        from_cache = False
        if kind not in UNCACHED:
            _cache[key] = (frame, more, ran_at)
            while len(_cache) > MAX_CACHED:
                _cache.popitem(last=False)
    seconds = time.monotonic() - started
    get_ipython().user_ns[options["out"]] = frame

    rows = len(frame)
    shown = f"first {rows:,} rows, more available" if more else f"{rows:,} row{'' if rows == 1 else 's'}"
    words = f"{options['out']} · {name} · {shown}"
    words += f" · from the cache, ran {int((time.time() - ran_at) // 60)} min ago" if from_cache else f" · {seconds:.1f} s"
    display(
        {
            MIME: {
                "connection": name,
                "out": options["out"],
                "rows": rows,
                "more": more,
                "limit": limit,
                "seconds": round(seconds, 3),
                "cached": from_cache,
                "ran_at": ran_at,
                # What Load all would cost in memory, per row, judged by the rows already here.
                "row_bytes": _row_bytes(frame) if more else None,
            },
            "text/plain": words,
        },
        raw=True,
    )
    return frame


def _row_bytes(frame):
    if len(frame) == 0:
        return None
    try:
        return int(frame.memory_usage(index=True, deep=True).sum() / len(frame))
    except Exception:
        return None


def count(name, query):
    """
    How many rows query answers, for Load all to say what it would read. The count is the query wrapped in
    count(*), so it is given COUNT_SECONDS and then cancelled, as an interrupt would.
    """
    counting = f"SELECT count(*) AS n FROM ({query.strip().rstrip(';')}) AS zasper_counted"
    try:
        frame, _ = _run(name, counting, 1, within=COUNT_SECONDS)
    except _TooLong:
        return _encode({"rows": None, "error": f"Counting took longer than {COUNT_SECONDS} seconds."})
    except SqlError as error:
        return _encode({"rows": None, "error": str(error)})
    return _encode({"rows": int(frame.iloc[0, 0])})


def schema(name):
    """Schemas, tables and views of a connection, without their columns, which are read on demand."""
    try:
        return _encode({"schemas": _schemas(name)})
    except SqlError as error:
        return _encode({"error": str(error), "missing": error.missing})
    except Exception as error:
        return _encode({"error": f"{type(error).__name__}: {error}"})


def _schemas(name):
    if name == DATAFRAMES:
        tables = [{"name": key, "kind": "dataframe", "rows": len(frame)} for key, frame in sorted(_frames().items())]
        return [{"name": "", "tables": tables}]
    spec = _connections.get(name) or _from_files(name)
    if spec is None:
        raise SqlError(f"There is no connection called {name}.")
    if spec["type"] == "sqlite":
        frame, _ = _run(name, "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name", None)
        return [{"name": "", "tables": [{"name": n, "kind": k} for n, k in frame.itertuples(index=False)]}]
    if spec["type"] == "duckdb":
        frame, _ = _run(
            name,
            "SELECT table_schema, table_name, table_type FROM information_schema.tables ORDER BY 1, 2",
            None,
        )
        return _grouped(frame.itertuples(index=False))
    try:
        from sqlalchemy import inspect
    except ImportError as error:
        raise _missing(error) from None
    _run(name, "SELECT 1", 1)
    inspector = inspect(_engines[name])
    default = inspector.default_schema_name
    answer = []
    for schema_name in inspector.get_schema_names():
        if schema_name in ("information_schema", "pg_catalog", "pg_toast") or schema_name.startswith("pg_temp"):
            continue
        tables = [{"name": t, "kind": "table"} for t in inspector.get_table_names(schema=schema_name)]
        tables += [{"name": v, "kind": "view"} for v in inspector.get_view_names(schema=schema_name)]
        answer.append({"name": schema_name, "default": schema_name == default, "tables": tables})
    return answer


def _grouped(rows):
    schemas = OrderedDict()
    for schema_name, table, kind in rows:
        schemas.setdefault(schema_name, []).append({"name": table, "kind": "view" if "VIEW" in kind else "table"})
    return [{"name": s, "tables": t} for s, t in schemas.items()]


def columns(name, schema_name, table):
    """A table's columns and their types, as the database names them."""
    try:
        return _encode({"columns": _columns(name, schema_name, table)})
    except SqlError as error:
        return _encode({"error": str(error), "missing": error.missing})
    except Exception as error:
        return _encode({"error": f"{type(error).__name__}: {error}"})


def _columns(name, schema_name, table):
    if name == DATAFRAMES:
        frame = _frames().get(table)
        if frame is None:
            raise SqlError(f"There is no dataframe called {table}.")
        return [{"name": str(c), "type": str(t)} for c, t in zip(frame.columns, frame.dtypes)]
    spec = _connections.get(name) or _from_files(name)
    if spec is None:
        raise SqlError(f"There is no connection called {name}.")
    if spec["type"] == "sqlite":
        frame, _ = _run(name, f"PRAGMA table_info({json.dumps(table)})", None)
        return [{"name": row["name"], "type": row["type"]} for _, row in frame.iterrows()]
    if spec["type"] == "duckdb":
        quoted_table = table.replace("'", "''")
        quoted_schema = (schema_name or "main").replace("'", "''")
        frame, _ = _run(
            name,
            "SELECT column_name, data_type FROM information_schema.columns "
            f"WHERE table_schema = '{quoted_schema}' AND table_name = '{quoted_table}' ORDER BY ordinal_position",
            None,
        )
        return [{"name": n, "type": t} for n, t in frame.itertuples(index=False)]
    from sqlalchemy import inspect

    _run(name, "SELECT 1", 1)
    inspector = inspect(_engines[name])
    return [{"name": c["name"], "type": str(c["type"])} for c in inspector.get_columns(table, schema=schema_name or None)]


def test(name):
    """Connects and answers what is on the other end, or why it could not."""
    started = time.monotonic()
    try:
        version = _version(name)
    except SqlError as error:
        return _encode({"ok": False, "error": str(error), "missing": error.missing})
    except Exception as error:
        return _encode({"ok": False, "error": f"{type(error).__name__}: {error}"})
    return _encode({"ok": True, "version": version, "ms": round((time.monotonic() - started) * 1000)})


def _version(name):
    spec = _connections.get(name) or _from_files(name)
    if spec is None:
        raise SqlError(f"There is no connection called {name}.")
    if spec["type"] == "sqlite":
        import sqlite3

        _run(name, "SELECT 1", 1)
        return "SQLite " + sqlite3.sqlite_version
    if spec["type"] == "duckdb":
        import duckdb

        _run(name, "SELECT 1", 1)
        return "DuckDB " + duckdb.__version__
    _run(name, "SELECT 1", 1)
    engine = _engines[name]
    with engine.connect() as connection:
        info = connection.dialect.server_version_info
    label = engine.dialect.name
    names = {"postgresql": "PostgreSQL", "mysql": "MySQL", "snowflake": "Snowflake", "bigquery": "BigQuery"}
    label = names.get(label, label)
    return label + (" " + ".".join(str(part) for part in info) if info else "")


def install():
    """Registers the magic, once per kernel."""
    shell = get_ipython()
    if shell is not None and "zasper_sql" not in shell.magics_manager.magics["cell"]:
        shell.register_magic_function(zasper_sql, "cell", "zasper_sql")
    return _encode(True)


try:
    install()
except Exception:
    pass
