package connections

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/httpx"
	"github.com/zasper-io/zasper/internal/kernel"
	"github.com/zasper-io/zasper/internal/trust"
)

// A schema can be large and a warehouse slow to wake: longer than a variable listing, shorter than forever.
const askTimeout = 60 * time.Second

// The Data panel's own kernel stops after this long with nothing asked of it.
const dataKernelIdle = 15 * time.Minute

// Kernels is what the handler needs of the running kernels.
type Kernels interface {
	Get(kernelId string) (*kernel.KernelManager, bool)
	Start(dir string, kernelName string, env map[string]string) (string, error)
	Stop(kernelId string) error
}

// Handler answers /api/connections.
type Handler struct {
	store   *Store
	kernels Kernels
	root    string
	// The kernel to start for the Data panel when no notebook is open, "" when there is no Python.
	pythonKernel func() string

	mu       sync.Mutex
	dataID   string
	lastUsed time.Time
}

// NewHandler serves the connections of the project at root.
func NewHandler(store *Store, kernels Kernels, root string, pythonKernel func() string) *Handler {
	return &Handler{store: store, kernels: kernels, root: root, pythonKernel: pythonKernel}
}

// ListHandler answers every connection, without passwords.
func (h *Handler) ListHandler(w http.ResponseWriter, req *http.Request) {
	list, err := h.store.List()
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, map[string]any{"connections": list, "types": Types})
}

type saveBody struct {
	Connection
	// The name being replaced, for a rename; empty for a new connection.
	Previous string `json:"previous,omitempty"`
	// Absent leaves the stored password; empty removes it.
	Password *string `json:"password,omitempty"`
}

// SaveHandler adds or changes a connection.
func (h *Handler) SaveHandler(w http.ResponseWriter, req *http.Request) {
	var body saveBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "a connection is a JSON object")
		return
	}
	if err := h.store.Save(body.Connection, body.Previous, body.Password); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	h.ListHandler(w, req)
}

type nameBody struct {
	Scope string `json:"scope"`
	Name  string `json:"name"`
}

// DeleteHandler removes a connection and its password.
func (h *Handler) DeleteHandler(w http.ResponseWriter, req *http.Request) {
	var body nameBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "say which connection")
		return
	}
	if err := h.store.Delete(body.Scope, body.Name); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	h.ListHandler(w, req)
}

type askBody struct {
	// The kernel to ask; the Data panel's own when empty.
	Kernel string `json:"kernel,omitempty"`
	Name   string `json:"name"`
	Schema string `json:"schema,omitempty"`
	Table  string `json:"table,omitempty"`
}

// kernelFor is the kernel a request names, or the Data panel's own, started if it has to be.
func (h *Handler) kernelFor(id string) (*kernel.KernelManager, error) {
	if id != "" {
		km, ok := h.kernels.Get(id)
		if !ok {
			return nil, errors.New("that kernel is not running")
		}
		return km, nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.lastUsed = time.Now()
	if km, ok := h.kernels.Get(h.dataID); h.dataID != "" && ok {
		return km, nil
	}
	name := h.pythonKernel()
	if name == "" {
		return nil, errors.New("reading a connection needs a Python kernel, and none is installed")
	}
	id, err := h.kernels.Start(h.root, name, nil)
	if err != nil {
		return nil, err
	}
	h.dataID = id
	go h.stopWhenIdle(id)
	km, _ := h.kernels.Get(id)
	return km, nil
}

func (h *Handler) stopWhenIdle(id string) {
	for {
		time.Sleep(time.Minute)
		h.mu.Lock()
		if h.dataID != id {
			h.mu.Unlock()
			return
		}
		if time.Since(h.lastUsed) >= dataKernelIdle {
			h.dataID = ""
			h.mu.Unlock()
			if err := h.kernels.Stop(id); err != nil {
				log.Debug().Err(err).Msg("the Data panel's kernel had already stopped")
			}
			return
		}
		h.mu.Unlock()
	}
}

// prepare hands the kernel the connection called name. The kernel's own dataframes need nothing.
func (h *Handler) prepare(ctx context.Context, km *kernel.KernelManager, name string) error {
	if name == Dataframes {
		return nil
	}
	c, ok := h.store.Find(name)
	if !ok {
		return errors.New("there is no connection called " + name)
	}
	return km.SQLRegister(ctx, name, h.store.SpecFor(c, nil))
}

func (h *Handler) decode(w http.ResponseWriter, req *http.Request) (askBody, *kernel.KernelManager, bool) {
	var body askBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body.Name == "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "say which connection")
		return body, nil, false
	}
	km, err := h.kernelFor(body.Kernel)
	if err != nil {
		if !trust.Refused(w, err) {
			httpx.SendErrorResponse(w, http.StatusConflict, err.Error())
		}
		return body, nil, false
	}
	return body, km, true
}

// PrepareHandler hands a notebook's kernel the connection a SQL cell is about to run on.
func (h *Handler) PrepareHandler(w http.ResponseWriter, req *http.Request) {
	body, km, ok := h.decode(w, req)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), askTimeout)
	defer cancel()
	if err := h.prepare(ctx, km, body.Name); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SchemaHandler answers a connection's schemas and tables.
func (h *Handler) SchemaHandler(w http.ResponseWriter, req *http.Request) {
	body, km, ok := h.decode(w, req)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), askTimeout)
	defer cancel()
	if err := h.prepare(ctx, km, body.Name); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	answer, err := km.SQLSchema(ctx, body.Name)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadGateway, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, answer)
}

// ColumnsHandler answers one table's columns.
func (h *Handler) ColumnsHandler(w http.ResponseWriter, req *http.Request) {
	body, km, ok := h.decode(w, req)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), askTimeout)
	defer cancel()
	if err := h.prepare(ctx, km, body.Name); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	answer, err := km.SQLColumns(ctx, body.Name, body.Schema, body.Table)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadGateway, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, answer)
}

type testBody struct {
	Kernel     string     `json:"kernel,omitempty"`
	Connection Connection `json:"connection"`
	// The password typed into the form, which may not be saved yet; absent uses the stored one.
	Password *string `json:"password,omitempty"`
}

// The name a connection is tested under, so testing an edit does not replace the saved one in a kernel.
const testName = "__zasper_test__"

// TestHandler connects with what a form holds, saved or not, and answers what is on the other end.
func (h *Handler) TestHandler(w http.ResponseWriter, req *http.Request) {
	var body testBody
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "a connection to test is a JSON object")
		return
	}
	if err := Validate(body.Connection); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, err.Error())
		return
	}
	km, err := h.kernelFor(body.Kernel)
	if err != nil {
		if !trust.Refused(w, err) {
			httpx.SendErrorResponse(w, http.StatusConflict, err.Error())
		}
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), askTimeout)
	defer cancel()
	if err := km.SQLRegister(ctx, testName, h.store.SpecFor(body.Connection, body.Password)); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadGateway, err.Error())
		return
	}
	answer, err := km.SQLTest(ctx, testName)
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusBadGateway, err.Error())
		return
	}
	httpx.SendJSON(w, http.StatusOK, answer)
}
