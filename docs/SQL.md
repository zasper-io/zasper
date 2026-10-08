# SQL cells and data connections

A SQL cell runs a query and leaves its answer in the kernel as a dataframe, which the next Python cell
can use. It runs on a **connection**, a database you have described once in Settings, or on
**Dataframes**, the pandas and polars frames the kernel already holds. The **Data panel** lists both,
down to their tables and columns.

This page covers how a SQL cell is saved, where connections and their passwords are kept, what runs
where, and what changes when a folder is not trusted.

## A SQL cell

In the notebook file, a SQL cell is a code cell whose first line is a cell magic:

```
%%zasper_sql warehouse --out df_orders --limit 1000
SELECT region, sum(total) AS revenue
FROM orders
GROUP BY 1
```

Zasper hides that line and shows the cell's head instead: the connection picker, and the name of the
dataframe the rows go into. Changing either rewrites the line. The cell type picker in the toolbar
turns a code cell into a SQL cell and back. The query keeps its text either way.

| Option             | Meaning                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `<connection>`     | A connection's name, or `dataframes`.                                                         |
| `--out <name>`     | The variable the rows are assigned to. `_` when it is left out.                               |
| `--limit <n>`      | At most this many rows, 1000 by default. `--limit none` reads them all.                       |
| `--fresh`          | Run the query again even when the cache holds its answer.                                     |

The cell's output starts with a line that says where the rows came from: the dataframe, the connection,
how many rows there are and how long the query took. **Load all** reruns the cell once with
`--limit none` when the limit left rows behind. **Run fresh** reruns it once past the cache. Neither
changes the cell. Then comes the dataframe, shown in the grid like any other.

Because it is a cell magic, the notebook stays a notebook other tools can open. JupyterLab and nbconvert
see a code cell (see [Outside Zasper](#outside-zasper)). The script export writes a SQL cell as a
commented `# %% [sql]` block. The Markdown export writes it as a fence tagged `sql`.

## Connections

Settings → Data connections adds, edits and removes them. Each one is kept for **this project** in
`<project>/.zasper/connections.json`, or for **all your projects** in `~/.zasper/connections.json`. A
project's connection with the same name as one of yours wins.

| Type       | Described by                         | Driver installed in the kernel  |
| ---------- | ------------------------------------ | ------------------------------- |
| PostgreSQL | host, port, database, user, password | `psycopg[binary]`               |
| MySQL      | host, port, database, user, password | `pymysql`                       |
| SQLite     | a file                               | none: Python's own `sqlite3`    |
| DuckDB     | a file, or none for one in memory    | `duckdb`                        |
| Snowflake  | host, database, user, password       | `snowflake-sqlalchemy`          |
| BigQuery   | host, database, user, password       | `sqlalchemy-bigquery`           |
| Redshift   | host, port, database, user, password | `sqlalchemy-redshift`           |
| Databricks | host, database, user, password       | `databricks-sqlalchemy`         |
| ClickHouse | host, port, database, user, password | `clickhouse-sqlalchemy`         |
| Other      | a SQLAlchemy URL, and a password     | the URL's dialect               |

A file path that is not absolute is read from the project's root. Everything except SQLite and DuckDB
goes through SQLAlchemy, which the kernel also needs.

**Test** in the dialog connects with what the form holds, saved or not, and says which server answered
and how quickly.

### Passwords

A password is never written to `connections.json`, so a project's connections can be committed and
shared. Each person who opens the project types their own password once. The password is kept in the
system keychain: macOS's Keychain, Windows' Credential Manager, or the Secret Service on Linux, under
the service `zasper`.

A machine with no keychain to ask, such as a headless server or a container, keeps passwords in
`~/.zasper/secrets.json` instead, readable by its owner alone (`0600`). A keychain that has not answered
within 20 seconds is treated the same way. macOS's waits indefinitely when it cannot ask anyone to unlock
it, as over SSH. Once that has happened, the server does not ask the keychain again until it restarts.

## Where a query runs

**In the kernel.** The server never connects to a database itself. Before a SQL cell runs, the server
hands the notebook's kernel that one connection, password included, and the kernel connects with its
own driver. The rows never pass through the server. They become a dataframe where the next cell can
use them, and the grid pages them from there as it does any other frame.

A kernel that lacks the driver says so: `psycopg[binary] is not installed in /path/to/python`. The
cell offers to install it, which runs `pip install` (or `uv pip install` in an environment without
pip) for that interpreter, then the cell can be run again.

A query the database refuses shows the database's own message, without a Python traceback.

**Dataframes** are queried with DuckDB, which reads the kernel's pandas and polars frames by name
without copying them. A SQL cell on Dataframes can join the output of one SQL cell with a frame a
Python cell made.

### The cache

The answer to a query on a database outside the kernel is kept in the kernel for an hour, keyed by the
connection, the query and the limit, so running a notebook from the top does not run every query again.
The line above the output says when an answer came from the cache and how old it is. **Run fresh**
skips it.

Dataframes, SQLite and DuckDB are never cached. They answer in milliseconds, and the notebook itself
changes them, so a cached answer could only be a stale one. The cache holds the last twenty answers and
is gone when the kernel restarts.

## The Data panel

The panel lists every connection. Opening one reads its schemas and tables, and opening a table reads
its columns and their types. **Query** on a table adds a SQL cell below the current one in the notebook
in front, reading the first hundred rows. The cell's dataframe takes a name no other cell writes. Under
**Dataframes** are the frames the front notebook's kernel holds, read again after each of its runs.

Reading a connection needs a kernel, and the panel works without a notebook open, so it starts one of
its own. It runs the same Python a file is run with: the one chosen in Settings, otherwise the project's
own `.venv`. Failing those, it uses `python3`, then the first Python kernel by name whose interpreter
still exists. It stops after 15 minutes without a question. Its drivers are that interpreter's, so a
driver the panel lacks is one the notebook will lack too.

The cell editor completes table and column names from the same reading, in the connection's dialect.

## In a folder that is not trusted

Running a SQL cell, testing a connection and reading one in the Data panel all run code in a kernel,
so in a restricted folder they ask for trust first, as Run does (see [TRUST.md](TRUST.md)). The panel
still lists connections by name, and Settings can still add, edit and remove them: those only read and
write `connections.json`.

## Outside Zasper

The magic is defined by a small module the server loads into the kernel, so JupyterLab does not know
it. A notebook that should also run there can load the module itself. `internal/kernel/sql.py` is
self-contained and registers the magic when it runs:

```python
exec(open("sql.py").read())
```

Without the server to hand it the connection, the module reads `.zasper/connections.json` from the
kernel's working directory and then `~/.zasper/connections.json`. It takes the password from the
environment variable `ZASPER_SQL_<NAME>_PASSWORD` (the name in capitals, with anything but letters and
digits as `_`). Failing that, for a connection kept for all your projects, it uses the `keyring` package
when it is installed.

## Files

| File                                                | What it does                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `internal/connections/connections.go`               | Reading, validating and saving connections in both scopes, and their passwords.              |
| `internal/connections/handler.go`                   | The `/api/connections` routes and the Data panel's kernel.                                    |
| `internal/secrets/secrets.go`                       | The keychain, the file it falls back to, and the time limit.                                  |
| `internal/kernel/sql.py`                            | The `%%zasper_sql` magic, the drivers, the cache, schema and column reading, in the kernel.   |
| `internal/kernel/sql.go`                            | The server's questions to that module.                                                        |
| `internal/kernel/install.go`                        | Installing a missing driver into a kernel's interpreter.                                      |
| `ui/src/ide/editor/notebook/sqlCell.ts`             | Reading and writing the magic line.                                                           |
| `ui/src/ide/editor/notebook/sqlEditor.ts`           | The hidden magic line, the SQL dialect and completion.                                        |
| `ui/src/ide/editor/notebook/SqlCellHead.tsx`        | The connection picker and the dataframe name.                                                 |
| `ui/src/ide/editor/notebook/SqlOutput.tsx`          | The provenance line, Load all, Run fresh, and the error with Install.                         |
| `ui/src/ide/sidebar/dataPanel/DataPanel.tsx`        | The Data panel.                                                                               |
| `ui/src/ide/editor/ConnectionDialog.tsx`            | Adding, editing and testing a connection.                                                     |
| `internal/server/sql_e2e_test.go`                   | A real kernel and SQLite: a run, provenance, an error, the cache, the panel's questions.      |
