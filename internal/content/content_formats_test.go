/*
A file read as content is text only when its bytes are UTF-8 text, and base64 otherwise, so that opening
and saving a file never changes what is in it.
*/
package content

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/models"
)

// projectFile writes one file into a fresh project and answers the project's directory.
func projectFile(t *testing.T, name string, data []byte) string {
	t.Helper()

	projectDir := projectDirElsewhere(t)
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, name), data, 0o644))
	return projectDir
}

// everyByte is all 256 byte values, which no text encoding carries unchanged.
func everyByte() []byte {
	data := make([]byte, 256)
	for i := range data {
		data[i] = byte(i)
	}
	return data
}

func TestAUTF8FileIsReadAsText(t *testing.T) {
	projectFile(t, "notes.txt", []byte("café ☕\n"))

	model, err := GetContent("notes.txt", "file", "", false)

	require.NoError(t, err)
	assert.Equal(t, "file", model.ContentType)
	assert.Equal(t, "text", model.Format)
	assert.Equal(t, "café ☕\n", model.Content)
}

func TestAFileThatIsNotUTF8TextIsReadAsBase64(t *testing.T) {
	for name, data := range map[string][]byte{
		"latin1.txt": []byte("caf\xe9\n"),
		"image.png":  []byte("\x89PNG\r\n\x1a\n"),
		"nul.txt":    []byte("a\x00b"),
	} {
		t.Run(name, func(t *testing.T) {
			projectFile(t, name, data)

			model, err := GetContent(name, "file", "", false)

			require.NoError(t, err)
			assert.Equal(t, "base64", model.Format)
			decoded, err := base64.StdEncoding.DecodeString(model.Content.(string))
			require.NoError(t, err)
			assert.Equal(t, data, decoded)
		})
	}
}

func TestAFileAskedForAsTextMustBeText(t *testing.T) {
	projectFile(t, "latin1.txt", []byte("caf\xe9\n"))

	_, err := GetContent("latin1.txt", "file", "text", false)

	assert.ErrorIs(t, err, errNotText)
}

func TestATextFileCanBeAskedForAsBase64(t *testing.T) {
	projectFile(t, "notes.txt", []byte("hello"))

	model, err := GetContent("notes.txt", "file", "base64", false)

	require.NoError(t, err)
	assert.Equal(t, "base64", model.Format)
	assert.Equal(t, base64.StdEncoding.EncodeToString([]byte("hello")), model.Content)
}

func TestAFileIsNotReadInAFormatThatDoesNotExist(t *testing.T) {
	projectFile(t, "notes.txt", []byte("hello"))

	_, err := GetContent("notes.txt", "file", "json", false)

	assert.Error(t, err)
}

func TestAFileOverTheSizeLimitIsNotRead(t *testing.T) {
	previous := maxContentSize
	maxContentSize = 8
	t.Cleanup(func() { maxContentSize = previous })

	projectDir := projectFile(t, "small.txt", []byte("12345678"))
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, "big.txt"), []byte("123456789"), 0o644))

	_, err := GetContent("small.txt", "file", "", false)
	require.NoError(t, err, "a file of exactly the limit is read")

	_, err = GetContent("big.txt", "file", "", false)
	require.Error(t, err)
	assert.Equal(t, "big.txt is 9 B, and files over 8 B are not opened here", err.Error())
}

func TestSizesAreWrittenForPeople(t *testing.T) {
	assert.Equal(t, "512 B", byteSize(512))
	assert.Equal(t, "10.0 MB", byteSize(10<<20))
	assert.Equal(t, "2.1 GB", byteSize(2254857830))
}

func TestAHashIsSentOnlyWhenAskedFor(t *testing.T) {
	projectFile(t, "notes.txt", []byte("hello"))

	without, err := GetContent("notes.txt", "file", "", false)
	require.NoError(t, err)
	assert.Empty(t, without.Hash)

	with, err := GetContent("notes.txt", "file", "", true)
	require.NoError(t, err)
	sum := sha256.Sum256([]byte("hello"))
	assert.Equal(t, hex.EncodeToString(sum[:]), with.Hash)
	assert.Equal(t, "sha256", with.HashAlgorithm)
}

func TestAFileWithNoKnownExtensionIsTypedByWhatItHolds(t *testing.T) {
	projectDir := projectFile(t, "notes.zasper-unknown", []byte("hello"))
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, "blob.zasper-unknown"), everyByte(), 0o644))

	text, err := GetContent("notes.zasper-unknown", "file", "", false)
	require.NoError(t, err)
	assert.Equal(t, "text/plain", text.Mimetype)

	binary, err := GetContent("blob.zasper-unknown", "file", "", false)
	require.NoError(t, err)
	assert.Equal(t, "application/octet-stream", binary.Mimetype)
}

func TestSavingBase64WritesTheBytesItCarries(t *testing.T) {
	projectDir := projectFile(t, "blob.bin", nil)

	require.NoError(t, UpdateContent("blob.bin", "file", "base64", base64.StdEncoding.EncodeToString(everyByte())))

	written, err := os.ReadFile(filepath.Join(projectDir, "blob.bin"))
	require.NoError(t, err)
	assert.Equal(t, everyByte(), written)
}

func TestASaveThatCannotBeDecodedLeavesTheFileAlone(t *testing.T) {
	for format, content := range map[string]string{"base64": "not base64!", "json": "{}"} {
		t.Run(format, func(t *testing.T) {
			projectDir := projectFile(t, "keep.txt", []byte("original"))

			assert.Error(t, UpdateContent("keep.txt", "file", format, content))

			written, err := os.ReadFile(filepath.Join(projectDir, "keep.txt"))
			require.NoError(t, err)
			assert.Equal(t, "original", string(written))
		})
	}
}

// Through the handlers and encoding/json, which is where a file sent as text had its bytes replaced
// with U+FFFD.
func TestEveryByteSurvivesOpeningAndSavingOverHTTP(t *testing.T) {
	projectDir := projectFile(t, "blob.bin", everyByte())
	path := filepath.Join(projectDir, "blob.bin")

	read := httptest.NewRecorder()
	ContentAPIHandler(read, httptest.NewRequest(http.MethodPost, "/api/contents", strings.NewReader(`{"path": "blob.bin"}`)))
	require.Equal(t, http.StatusOK, read.Code, "body was %s", read.Body)
	var model models.ContentModel
	require.NoError(t, json.Unmarshal(read.Body.Bytes(), &model))

	// Emptied first, so only the save can put the bytes back.
	require.NoError(t, os.WriteFile(path, nil, 0o644))
	save, err := json.Marshal(map[string]any{"path": "blob.bin", "type": "file", "format": model.Format, "content": model.Content})
	require.NoError(t, err)
	saved := httptest.NewRecorder()
	ContentUpdateAPIHandler(saved, httptest.NewRequest(http.MethodPut, "/api/contents", bytes.NewReader(save)))
	require.Equal(t, http.StatusOK, saved.Code, "body was %s", saved.Body)

	written, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, everyByte(), written)
}

func TestAHashIsAskedForWithZeroOrOne(t *testing.T) {
	projectFile(t, "notes.txt", []byte("hello"))

	for hash, want := range map[string]int{"": http.StatusOK, "0": http.StatusOK, "1": http.StatusOK, "2": http.StatusBadRequest, "yes": http.StatusBadRequest} {
		recorder := httptest.NewRecorder()
		body := `{"path": "notes.txt", "hash": "` + hash + `"}`
		ContentAPIHandler(recorder, httptest.NewRequest(http.MethodPost, "/api/contents", strings.NewReader(body)))
		assert.Equal(t, want, recorder.Code, "hash %q", hash)
	}
}
