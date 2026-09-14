package health

import (
	"net/http"

	zhttp "github.com/zasper-io/zasper/internal/http"
)

func HealthCheckHandler(w http.ResponseWriter, r *http.Request) {
	zhttp.SendJSON(w, http.StatusOK, map[string]bool{"alive": true})
}
