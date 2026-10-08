package content

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const runNotebook45 = `{
 "cells": [
  {
   "cell_type": "markdown",
   "id": "intro",
   "metadata": {},
   "source": [
    "# Notes"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": null,
   "id": "train",
   "metadata": {
    "tags": [
     "keep"
    ]
   },
   "outputs": [],
   "source": [
    "train()"
   ]
  }
 ],
 "metadata": {
  "kernelspec": {
   "display_name": "Python 3",
   "language": "python",
   "name": "python3"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}
`

var streamOutput = []map[string]interface{}{{"output_type": "stream", "name": "stdout", "text": "epoch 1\nepoch 2\n"}}

func TestARunsOutputIsWrittenIntoItsCellAndNothingElseChanges(t *testing.T) {
	project, dir := testProject(t)
	path := filepath.Join(dir, "train.ipynb")
	require.NoError(t, os.WriteFile(path, []byte(runNotebook45), 0o644))

	require.NoError(t, project.WriteRunOutputs("train.ipynb", "train", "train()", 7, streamOutput, nil))

	written, err := os.ReadFile(path)
	require.NoError(t, err)
	expected := `{
 "cells": [
  {
   "cell_type": "markdown",
   "id": "intro",
   "metadata": {},
   "source": [
    "# Notes"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 7,
   "id": "train",
   "metadata": {
    "tags": [
     "keep"
    ]
   },
   "outputs": [
    {
     "name": "stdout",
     "output_type": "stream",
     "text": [
      "epoch 1\n",
      "epoch 2\n"
     ]
    }
   ],
   "source": [
    "train()"
   ]
  }
 ],
 "metadata": {
  "kernelspec": {
   "display_name": "Python 3",
   "language": "python",
   "name": "python3"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}
`
	assert.Equal(t, expected, string(written))
}

func TestANotebookWithoutCellIdsIsMatchedByTheCodeThatRan(t *testing.T) {
	project, dir := testProject(t)
	path := filepath.Join(dir, "old.ipynb")
	require.NoError(t, os.WriteFile(path, []byte(`{"cells": [
		{"cell_type": "code", "execution_count": null, "metadata": {}, "outputs": [], "source": "setup()"},
		{"cell_type": "code", "execution_count": null, "metadata": {}, "outputs": [], "source": "train()\n"}
	], "metadata": {}, "nbformat": 4, "nbformat_minor": 4}`), 0o644))

	require.NoError(t, project.WriteRunOutputs("old.ipynb", "made-up-by-a-tab", "train()", 2, streamOutput, nil))

	written, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Contains(t, string(written), `"execution_count": 2`)
	assert.Contains(t, string(written), "epoch 1")
	assert.NotContains(t, string(written), `"id"`, "a 4.4 file is not given ids")
}

func TestTwoCellsHoldingTheCodeThatRanLeaveTheFileAlone(t *testing.T) {
	project, dir := testProject(t)
	path := filepath.Join(dir, "twice.ipynb")
	original := `{"cells": [
		{"cell_type": "code", "execution_count": null, "metadata": {}, "outputs": [], "source": "df.head()"},
		{"cell_type": "code", "execution_count": null, "metadata": {}, "outputs": [], "source": "df.head()"}
	], "metadata": {}, "nbformat": 4, "nbformat_minor": 4}`
	require.NoError(t, os.WriteFile(path, []byte(original), 0o644))

	err := project.WriteRunOutputs("twice.ipynb", "", "df.head()", 1, streamOutput, nil)
	assert.ErrorIs(t, err, ErrCellNotFound)

	written, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, original, string(written))
}

// When each run began and ended goes into the cell's metadata under JupyterLab's keys, beside what the
// cell's metadata already held.
func TestARunsTimesAreWrittenIntoItsMetadata(t *testing.T) {
	project, dir := testProject(t)
	path := filepath.Join(dir, "train.ipynb")
	require.NoError(t, os.WriteFile(path, []byte(runNotebook45), 0o644))

	times := map[string]string{
		"iopub.status.busy":   "2026-10-07T08:33:12.098Z",
		"iopub.execute_input": "2026-10-07T08:33:12.104Z",
		"shell.execute_reply": "2026-10-07T08:35:26.402Z",
	}
	require.NoError(t, project.WriteRunOutputs("train.ipynb", "train", "train()", 7, streamOutput, times))

	written, err := os.ReadFile(path)
	require.NoError(t, err)
	var doc struct {
		Cells []struct {
			Metadata map[string]interface{} `json:"metadata"`
		} `json:"cells"`
	}
	require.NoError(t, json.Unmarshal(written, &doc))
	metadata := doc.Cells[1].Metadata
	assert.Equal(t, []interface{}{"keep"}, metadata["tags"])
	assert.Equal(t, map[string]interface{}{
		"iopub.status.busy":   "2026-10-07T08:33:12.098Z",
		"iopub.execute_input": "2026-10-07T08:33:12.104Z",
		"shell.execute_reply": "2026-10-07T08:35:26.402Z",
	}, metadata["execution"])
}
