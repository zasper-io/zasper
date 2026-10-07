package kernel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"

	"github.com/gorilla/mux"
	"github.com/rs/zerolog/log"

	"github.com/zasper-io/zasper/internal/analytics"
	"github.com/zasper-io/zasper/internal/httpx"
)

// ListHandler answers every running kernel.
func (k *Kernels) ListHandler(w http.ResponseWriter, req *http.Request) {
	httpx.SendJSON(w, http.StatusOK, k.list())
}

// ResourcesHandler answers the memory and GPU memory every running kernel holds, and how full the machine
// is. One answer for all of them, so the status bar and the Jupyter panel share a read.
func (k *Kernels) ResourcesHandler(w http.ResponseWriter, req *http.Request) {
	httpx.SendJSON(w, http.StatusOK, k.Resources(req.Context()))
}

// GetHandler answers one running kernel.
func (k *Kernels) GetHandler(w http.ResponseWriter, req *http.Request) {
	kernel, err := k.model(mux.Vars(req)["kernelId"])
	if err != nil {
		httpx.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error getting kernel: %v", err))
		return
	}
	httpx.SendJSON(w, http.StatusOK, kernel)
}

// InterruptHandler interrupts a running kernel.
func (k *Kernels) InterruptHandler(w http.ResponseWriter, req *http.Request) {
	kernelId := mux.Vars(req)["kernelId"]
	log.Debug().Msgf("interrupting kernel %s", kernelId)

	err := k.interrupt(kernelId)
	if errors.Is(err, ErrKernelNotFound) {
		httpx.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error interrupting kernel: %v", err))
		return
	}
	if err != nil {
		log.Error().Msgf("Error interrupting kernel: %v", err)
		httpx.SendErrorResponse(w, http.StatusInternalServerError, fmt.Sprintf("Error interrupting kernel: %v", err))
		return
	}

	language := "other"
	if km, ok := k.Get(kernelId); ok {
		language = analytics.NormalizeLanguage(km.KernelName)
	}
	analytics.Track(analytics.EventKernelInterrupted, map[string]interface{}{
		"kernel_language": language,
	})

	httpx.SendJSON(w, http.StatusOK, map[string]string{
		"message": "Kernel interrupted successfully",
	})
}

// KillHandler stops a running kernel.
func (k *Kernels) KillHandler(w http.ResponseWriter, req *http.Request) {
	kernelId := mux.Vars(req)["kernelId"]
	log.Debug().Msgf("stopping kernel %s", kernelId)

	if err := k.Stop(kernelId); err != nil {
		httpx.SendErrorResponse(w, http.StatusNotFound, fmt.Sprintf("Error killing kernel: %v", err))
		return
	}

	httpx.SendJSON(w, http.StatusOK, map[string]string{
		"message": "Kernel killed successfully",
	})
}

const (
	// How long a variables request waits for the kernel. A request sent while a cell runs is answered when
	// the cell finishes, so this is also how long the panel says it is waiting before giving up.
	inspectTimeout = 10 * time.Second
	previewRows    = 100
	maxPreviewRows = 1000
	maxFilters     = 20
)

// A variable's name, or `@` and the id a cell's DataFrame output carries.
var identifier = regexp.MustCompile(`^(?:[A-Za-z_][A-Za-z0-9_]*|@[0-9a-f]{32})$`)

// maxExportRows is how many rows a CSV export carries at most: the answer travels through the kernel's
// reply as one string.
const maxExportRows = 100_000

// VariablesHandler lists the names in a kernel's namespace.
func (k *Kernels) VariablesHandler(w http.ResponseWriter, req *http.Request) {
	km, ok := k.Get(mux.Vars(req)["kernelId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "kernel not found")
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), inspectTimeout)
	defer cancel()

	variables, err := km.Variables(ctx)
	if err != nil {
		sendInspectError(w, err)
		return
	}
	httpx.SendJSON(w, http.StatusOK, variables)
}

// RowsHandler answers a page of a table-like variable, after the filters and sort in the request body.
func (k *Kernels) RowsHandler(w http.ResponseWriter, req *http.Request) {
	km, name, ok := k.inspected(w, req)
	if !ok {
		return
	}
	query := Query{Limit: previewRows}
	if err := json.NewDecoder(io.LimitReader(req.Body, 64<<10)).Decode(&query); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "malformed query")
		return
	}
	if problem := checkQuery(query); problem != "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, problem)
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), inspectTimeout)
	defer cancel()
	page, err := km.Rows(ctx, name, query)
	if err != nil {
		sendInspectError(w, err)
		return
	}
	if page.Error != "" {
		httpx.SendErrorResponse(w, answeredStatus(page.Gone), page.Error)
		return
	}
	httpx.SendJSON(w, http.StatusOK, page)
}

// ProfileHandler answers what is in each column of a table-like variable.
func (k *Kernels) ProfileHandler(w http.ResponseWriter, req *http.Request) {
	km, name, ok := k.inspected(w, req)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), inspectTimeout)
	defer cancel()
	profile, err := km.Profile(ctx, name)
	if err != nil {
		sendInspectError(w, err)
		return
	}
	if profile.Error != "" {
		httpx.SendErrorResponse(w, answeredStatus(profile.Gone), profile.Error)
		return
	}
	httpx.SendJSON(w, http.StatusOK, profile)
}

// CSVHandler answers the rows a query leaves as a CSV file, the first maxExportRows of them.
func (k *Kernels) CSVHandler(w http.ResponseWriter, req *http.Request) {
	km, name, ok := k.inspected(w, req)
	if !ok {
		return
	}
	query := Query{Limit: maxExportRows}
	if err := json.NewDecoder(io.LimitReader(req.Body, 64<<10)).Decode(&query); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "malformed query")
		return
	}
	query.Offset, query.Limit = 0, maxExportRows
	if problem := checkQuery(Query{Limit: 1, Sort: query.Sort, Filters: query.Filters, Columns: query.Columns}); problem != "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, problem)
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), inspectTimeout)
	defer cancel()
	export, err := km.CSV(ctx, name, query)
	if err != nil {
		sendInspectError(w, err)
		return
	}
	if export.Error != "" {
		httpx.SendErrorResponse(w, answeredStatus(export.Gone), export.Error)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	_, _ = io.WriteString(w, export.CSV)
}

// ChartHandler answers what a chart of a table-like variable draws, after the filters in the request.
func (k *Kernels) ChartHandler(w http.ResponseWriter, req *http.Request) {
	km, name, ok := k.inspected(w, req)
	if !ok {
		return
	}
	var query ChartQuery
	if err := json.NewDecoder(io.LimitReader(req.Body, 64<<10)).Decode(&query); err != nil {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "malformed query")
		return
	}
	if problem := checkChartQuery(query); problem != "" {
		httpx.SendErrorResponse(w, http.StatusBadRequest, problem)
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), inspectTimeout)
	defer cancel()
	answer, problem, err := km.Chart(ctx, name, query)
	if err != nil {
		sendInspectError(w, err)
		return
	}
	if problem.Error != "" {
		httpx.SendErrorResponse(w, answeredStatus(problem.Gone), problem.Error)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(answer)
}

// answeredStatus is the status for a question the kernel answered with an error: 410 for a table it
// has let go, which a client tells apart from a question it got wrong.
func answeredStatus(gone bool) int {
	if gone {
		return http.StatusGone
	}
	return http.StatusUnprocessableEntity
}

// inspected answers the kernel and variable a request names, having answered the request itself when
// either is not there to inspect.
func (k *Kernels) inspected(w http.ResponseWriter, req *http.Request) (*KernelManager, string, bool) {
	vars := mux.Vars(req)
	km, ok := k.Get(vars["kernelId"])
	if !ok {
		httpx.SendErrorResponse(w, http.StatusNotFound, "kernel not found")
		return nil, "", false
	}
	if !identifier.MatchString(vars["name"]) {
		httpx.SendErrorResponse(w, http.StatusBadRequest, "not a variable name")
		return nil, "", false
	}
	return km, vars["name"], true
}

func checkQuery(query Query) string {
	if query.Offset < 0 {
		return "offset must not be negative"
	}
	if query.Limit < 1 || query.Limit > maxPreviewRows {
		return fmt.Sprintf("limit must be between 1 and %d", maxPreviewRows)
	}
	if query.Sort != nil && query.Sort.Column < 0 {
		return "no such column"
	}
	if len(query.Filters) > maxFilters {
		return fmt.Sprintf("at most %d filters", maxFilters)
	}
	for _, column := range query.Columns {
		if column < 0 {
			return "no such column"
		}
	}
	for _, filter := range query.Filters {
		if !FilterOps[filter.Op] {
			return fmt.Sprintf("unknown filter %q", filter.Op)
		}
		if filter.Column < 0 {
			return "no such column"
		}
	}
	return ""
}

func checkChartQuery(query ChartQuery) string {
	if !ChartKinds[query.Kind] {
		return fmt.Sprintf("unknown chart %q", query.Kind)
	}
	if query.Agg != "" && !ChartAggregates[query.Agg] {
		return fmt.Sprintf("unknown aggregate %q", query.Agg)
	}
	if len(query.Y) > 3 {
		return "a chart draws at most three columns"
	}
	for _, column := range append(append([]int{}, query.Y...), derefs(query.X, query.Color)...) {
		if column < 0 {
			return "no such column"
		}
	}
	return checkQuery(Query{Limit: 1, Filters: query.Filters})
}

func derefs(columns ...*int) []int {
	found := []int{}
	for _, column := range columns {
		if column != nil {
			found = append(found, *column)
		}
	}
	return found
}

func sendInspectError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotInspectable):
		httpx.SendErrorResponse(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, context.DeadlineExceeded):
		httpx.SendErrorResponse(w, http.StatusGatewayTimeout, "the kernel is busy; try again once the running cell finishes")
	default:
		httpx.SendErrorResponse(w, http.StatusInternalServerError, err.Error())
	}
}
