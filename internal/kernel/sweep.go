package kernel

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// How old a connection file must be before a sweep may take it: a kernel still starting has written its
// file and not yet bound its ports.
const sweepAfter = time.Minute

/*
SweepConnectionFiles deletes the connection files of kernels that are no longer running, from servers
that were killed or crashed before they could stop them. Each holds a kernel's signing key. Several
servers share the folder, so a file is taken only when its kernel does not answer on its shell port.
*/
func SweepConnectionFiles() {
	sweepConnectionFiles(runtimeDir(), time.Now(), listening)
}

func sweepConnectionFiles(dir string, now time.Time, alive func(conn *Connection, port int) bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	swept := 0
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "kernel-") || !strings.HasSuffix(name, ".json") {
			continue
		}
		info, err := entry.Info()
		if err != nil || now.Sub(info.ModTime()) < sweepAfter {
			continue
		}
		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var file ConnectionFileData
		parsed := json.Unmarshal(data, &file) == nil
		connection := &Connection{IP: file.IP, Transport: file.Transport, ShellPort: file.ShellPort,
			IopubPort: file.IopubPort, StdinPort: file.StdinPort, HbPort: file.HbPort, ControlPort: file.ControlPort}
		if connection.IP == "" {
			connection.IP = "127.0.0.1"
		}
		if parsed && connection.ShellPort != 0 && alive(connection, connection.ShellPort) {
			continue
		}
		if parsed {
			connection.removeSockets()
		}
		if os.Remove(path) == nil {
			swept++
		}
	}
	if swept > 0 {
		log.Debug().Msgf("removed %d connection files of kernels no longer running", swept)
	}
}

func listening(connection *Connection, port int) bool {
	network, address := connection.endpoint(port)
	conn, err := net.DialTimeout(network, address, 200*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
