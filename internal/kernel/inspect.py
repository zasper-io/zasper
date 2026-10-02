# Run inside a Python kernel as the module `_zasper_inspect`, never in the user's namespace. Every
# answer is base64 JSON, so it survives being returned as the repr of a str.
import base64
import json
import math
import reprlib
import types

from IPython import get_ipython

_summary = reprlib.Repr()
_summary.maxstring = 120
_summary.maxother = 120

MAX_COLUMNS = 200
_SKIPPED = (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, types.MethodType, type)


def _encode(answer):
    return base64.b64encode(json.dumps(answer, allow_nan=False, default=str).encode()).decode()


def _namespace():
    shell = get_ipython()
    hidden = getattr(shell, "user_ns_hidden", {})
    return shell.user_ns, hidden


def _kind(value):
    module = type(value).__module__.split(".")[0]
    name = type(value).__name__
    if module == "pandas" and name == "DataFrame":
        return "dataframe"
    if module == "pandas" and name == "Series":
        return "series"
    if module == "polars" and name == "DataFrame":
        return "dataframe"
    if module == "numpy" and name == "ndarray":
        return "array"
    return "other"


def _shape(value):
    try:
        shape = getattr(value, "shape", None)
    except Exception:
        return None
    if isinstance(shape, tuple) and all(isinstance(n, int) for n in shape):
        return list(shape)
    return None


def _size(value):
    if isinstance(value, (str, bytes, list, tuple, dict, set, frozenset)):
        return len(value)
    return None


def _describe(name, value):
    kind = _kind(value)
    shape = _shape(value)
    if kind == "dataframe":
        names = [str(column) for column in list(value.columns)[:6]]
        summary = ", ".join(names) + (", …" if len(value.columns) > 6 else "")
    elif kind in ("series", "array"):
        summary = f"dtype {getattr(value, 'dtype', '?')}"
    else:
        try:
            summary = _summary.repr(value)
        except Exception:
            summary = "<no repr>"
    viewable = kind in ("dataframe", "series") or (
        kind == "array" and shape is not None and 1 <= len(shape) <= 2
    )
    return {
        "name": name,
        "type": type(value).__name__,
        "module": type(value).__module__,
        "kind": kind,
        "shape": shape,
        "size": _size(value),
        "summary": summary,
        "viewable": viewable,
    }


def variables():
    namespace, hidden = _namespace()
    found = []
    for name, value in list(namespace.items()):
        if name.startswith("_") or name in hidden or isinstance(value, _SKIPPED):
            continue
        found.append(_describe(name, value))
    found.sort(key=lambda each: each["name"].lower())
    return _encode(found)


def _missing(item):
    if item is None:
        return "None"
    if isinstance(item, float) and math.isnan(item):
        return "NaN"
    name = type(item).__name__
    if name == "NaTType" or (name in ("datetime64", "timedelta64") and str(item) == "NaT"):
        return "NaT"
    if name == "NAType":
        return "<NA>"
    return None


def _value(item):
    missing = _missing(item)
    if missing is not None:
        return {"missing": missing}
    if hasattr(item, "item") and type(item).__module__.split(".")[0] == "numpy":
        try:
            item = item.item()
        except Exception:
            pass
    if isinstance(item, bool):
        return item
    if isinstance(item, int):
        return item if abs(item) < 2**53 else str(item)
    if isinstance(item, float):
        return item if math.isfinite(item) else str(item)
    if not isinstance(item, str):
        try:
            item = str(item)
        except Exception:
            return "<no str>"
    return item if len(item) <= 500 else item[:500] + "…"


def _page(columns, index, rows, total, offset):
    return {
        "columns": columns[:MAX_COLUMNS],
        "total_columns": len(columns),
        "index": index,
        "rows": [[_value(item) for item in row[:MAX_COLUMNS]] for row in rows],
        "total_rows": total,
        "offset": offset,
    }


def preview(name, offset, limit):
    namespace, _ = _namespace()
    if name not in namespace:
        return _encode({"error": f"{name} is not defined in the kernel"})
    value = namespace[name]
    kind = _kind(value)
    module = type(value).__module__.split(".")[0]
    end = offset + limit

    if kind == "series":
        value = value.to_frame()
        kind = "dataframe"
    if kind == "dataframe" and module == "pandas":
        page = value.iloc[offset:end]
        columns = [{"name": str(column), "dtype": str(dtype)} for column, dtype in value.dtypes.items()]
        rows = [list(row) for row in page.itertuples(index=False, name=None)]
        return _encode(_page(columns, [str(label) for label in page.index], rows, len(value), offset))
    if kind == "dataframe" and module == "polars":
        page = value.slice(offset, limit)
        columns = [{"name": str(column), "dtype": str(dtype)} for column, dtype in value.schema.items()]
        index = [str(n) for n in range(offset, offset + page.height)]
        return _encode(_page(columns, index, [list(row) for row in page.rows()], value.height, offset))
    if kind == "array" and value.ndim in (1, 2):
        page = value[offset:end]
        if value.ndim == 1:
            columns = [{"name": "0", "dtype": str(value.dtype)}]
            rows = [[item] for item in page]
        else:
            columns = [{"name": str(n), "dtype": str(value.dtype)} for n in range(value.shape[1])]
            rows = [list(row) for row in page]
        index = [str(n) for n in range(offset, offset + len(page))]
        return _encode(_page(columns, index, rows, value.shape[0], offset))
    return _encode({"error": f"{name} is a {type(value).__name__}, which cannot be shown as a table"})
