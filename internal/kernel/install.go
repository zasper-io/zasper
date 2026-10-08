package kernel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/zasper-io/zasper/internal/httpx"
)

// A package as pip names one, extras included: psycopg[binary]. No version specifiers, URLs or flags.
var packageName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?$`)

const installTimeout = 10 * time.Minute

// Installed is what installing a package said.
type Installed struct {
	OK  bool   `json:"ok"`
	Log string `json:"log"`
}

// Install installs a package into the interpreter the kernel runs, with pip, or with uv when the
// environment has no pip, as uv's own environments do not. Run from the temp directory, so nothing in
// the notebook's folder is imported along the way.
func (km *KernelManager) Install(ctx context.Context, name string) (Installed, error) {
	if !packageName.MatchString(name) {
		return Installed{}, fmt.Errorf("%q is not a package name", name)
	}
	argv := km.argv()
	if len(argv) == 0 || !strings.EqualFold(km.Spec.Language, "python") {
		return Installed{}, ErrNotInspectable
	}
	python := argv[0]
	out, err := run(ctx, python, "-m", "pip", "install", name)
	if err != nil && strings.Contains(out, "No module named pip") {
		if uv, lookErr := exec.LookPath("uv"); lookErr == nil {
			out, err = run(ctx, uv, "pip", "install", "--python", python, name)
		}
	}
	return Installed{OK: err == nil, Log: out}, nil
}

func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = os.TempDir()
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	return out.String(), err
}

// InstallHandler installs a package, such as a database driver, into the kernel's own environment.
func (k *Kernels) InstallHandler(w http.ResponseWriter, req *http.Request) {
	km, ok := k.Get(mux.Vars(req)["kernelId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "kernel not found")
		return
	}
	var body struct {
		Package string `json:"package"`
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "say which package")
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), installTimeout)
	defer cancel()
	answer, err := km.Install(ctx, body.Package)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, answer)
}
