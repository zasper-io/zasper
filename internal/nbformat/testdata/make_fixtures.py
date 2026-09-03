"""Builds one representative notebook per nbformat version, validating each fixture."""

import json
import os

import nbformat
from nbformat import validate, ValidationError

# Beside this script, wherever the checkout happens to be.
OUT = os.path.dirname(os.path.abspath(__file__))

PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gEB2Z"
    "kAAAAASUVORK5CYII="
)


def v4_notebook(minor):
    nb = nbformat.v4.new_notebook()
    nb.nbformat_minor = minor
    nb.metadata = {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {
            "name": "python",
            "version": "3.9.6",
            "codemirror_mode": {"name": "ipython", "version": 3},
            "file_extension": ".py",
            "mimetype": "text/x-python",
        },
        "widgets": {"state": {}},
    }

    code = nbformat.v4.new_code_cell(source="print('one')\nprint('two')")
    code.execution_count = 1
    code.outputs = [
        nbformat.v4.new_output("stream", name="stdout", text="one\ntwo\n"),
        nbformat.v4.new_output(
            "execute_result",
            data={"text/plain": "42", "text/html": "<b>42</b>"},
            execution_count=1,
        ),
        nbformat.v4.new_output(
            "error",
            ename="ValueError",
            evalue="boom",
            traceback=["Traceback (most recent call last):", "ValueError: boom"],
        ),
    ]

    md = nbformat.v4.new_markdown_cell(source="# Title\n\nsome *text*")
    raw = nbformat.v4.new_raw_cell(source="raw body\n")

    # Attachments are a 4.1+ feature.
    if minor >= 1:
        md.attachments = {"pixel.png": {"image/png": PNG}}

    nb.cells = [code, md, raw]

    # Cell ids are a 4.5 feature; nbformat's constructors add them unconditionally.
    if minor < 5:
        for cell in nb.cells:
            cell.pop("id", None)

    return nb


def write(nb, name, version, minor):
    path = os.path.join(OUT, name)
    try:
        validate(nb, version=version, version_minor=minor)
        status = "valid"
    except ValidationError as err:
        status = f"INVALID FIXTURE: {err}"
    # nbformat's own writer, so the fixture is byte-for-byte what Jupyter would put on disk:
    # multiline strings split into lines, keys sorted, indent 1, trailing newline.
    with open(path, "w") as handle:
        nbformat.write(nb, handle, version=version)
    print(f"{name}: nbformat {version}.{minor} -> {status}")


for minor in range(0, 6):
    write(v4_notebook(minor), f"v4.{minor}.ipynb", 4, minor)

# v3 keeps its cells under worksheets, which is the shape Zasper has never seen.
v3 = nbformat.convert(v4_notebook(5), to_version=3)
write(v3, "v3.ipynb", 3, v3.get("nbformat_minor", 0))
