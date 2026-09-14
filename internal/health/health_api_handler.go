package health

import (
	"net/http"

	"github.com/zasper-io/zasper/internal/httpx"
)

func HealthCheckHandler(w http.ResponseWriter, r *http.Request) {
	httpx.SendJSON(w, http.StatusOK, map[string]bool{"alive": true})
}
