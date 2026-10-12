/*
Package mcpbridge is `zasper mcp`: it lets an agent that speaks MCP over stdio, which is most of them, use
the running Zasper server's /mcp. It finds the server for the project in ~/.zasper/runtime, signs in with
its access token, and passes each message on stdin to /mcp and each answer back on stdout, one JSON-RPC
message per line as the stdio transport has them. It knows nothing about the tools: it relays bytes.
*/
package mcpbridge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zasper-io/zasper/internal/runtimeinfo"
)

// Find is the running server for the project in dir: the one whose project holds dir, the deepest when
// several do, or the only one running when none does.
func Find(dir string, servers []runtimeinfo.Info, alive func(runtimeinfo.Info) bool) (runtimeinfo.Info, error) {
	var running []runtimeinfo.Info
	for _, server := range servers {
		if alive(server) {
			running = append(running, server)
		}
	}
	if len(running) == 0 {
		return runtimeinfo.Info{}, errors.New("no Zasper server is running: start one with `zasper` in the project")
	}
	var best runtimeinfo.Info
	for _, server := range running {
		rel, err := filepath.Rel(server.Project, dir)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) &&
			len(server.Project) > len(best.Project) {
			best = server
		}
	}
	if best.URL != "" {
		return best, nil
	}
	if len(running) == 1 {
		return running[0], nil
	}
	projects := make([]string, len(running))
	for i, server := range running {
		projects[i] = server.Project
	}
	return runtimeinfo.Info{}, fmt.Errorf("several Zasper servers are running and none is for %s: run `zasper mcp` in one of %s", dir, strings.Join(projects, ", "))
}

// Alive says whether a recorded server still answers.
func Alive(client *http.Client) func(runtimeinfo.Info) bool {
	return func(server runtimeinfo.Info) bool {
		answer, err := client.Get(server.URL + "/api/health")
		if err != nil {
			return false
		}
		answer.Body.Close()
		return answer.StatusCode == http.StatusOK
	}
}

// Bridge relays one stdio MCP connection to a server's /mcp.
type Bridge struct {
	server    runtimeinfo.Info
	client    *http.Client
	session   string
	sessionID string
	// The protocol version initialize agreed, which HTTP requests after it say in a header.
	version string
	out     io.Writer
	writing sync.Mutex
}

// Connect signs in to server.
func Connect(ctx context.Context, server runtimeinfo.Info, client *http.Client) (*Bridge, error) {
	credentials, _ := json.Marshal(map[string]string{"accessToken": server.Token})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/auth/login", bytes.NewReader(credentials))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	answer, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach Zasper at %s: %w", server.URL, err)
	}
	defer answer.Body.Close()
	if answer.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Zasper at %s refused to sign in (%s)", server.URL, answer.Status)
	}
	var login struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(answer.Body).Decode(&login); err != nil {
		return nil, err
	}
	return &Bridge{server: server, client: client, session: login.Token}, nil
}

/*
Serve relays messages from in to the server and its answers to out until in ends. The first message is
the initialize, which is answered before anything else is sent, since it is what gives the session its
id; after it, messages are sent as they come, so a long run_cell does not hold up a ping.
*/
func (b *Bridge) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	b.out = out
	lines := bufio.NewScanner(in)
	lines.Buffer(make([]byte, 0, 64<<10), 64<<20)
	var pending sync.WaitGroup
	first := true
	for lines.Scan() {
		message := bytes.TrimSpace(lines.Bytes())
		if len(message) == 0 {
			continue
		}
		message = append([]byte(nil), message...)
		if first {
			first = false
			b.relay(ctx, message)
			continue
		}
		pending.Add(1)
		go func() {
			defer pending.Done()
			b.relay(ctx, message)
		}()
	}
	pending.Wait()
	b.end(ctx)
	return lines.Err()
}

func (b *Bridge) relay(ctx context.Context, message []byte) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.server.URL+"/mcp", bytes.NewReader(message))
	if err != nil {
		b.fail(message, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer "+b.session)
	if b.sessionID != "" {
		req.Header.Set("Mcp-Session-Id", b.sessionID)
	}
	if version := versionOf(message, b.version); version != "" {
		req.Header.Set("Mcp-Protocol-Version", version)
	}
	// What newer protocol versions ask an HTTP request to repeat from its body; older ones ignore them.
	for name, value := range headersOf(message) {
		req.Header.Set(name, value)
	}
	answer, err := b.client.Do(req)
	if err != nil {
		b.fail(message, err)
		return
	}
	defer answer.Body.Close()
	if id := answer.Header.Get("Mcp-Session-Id"); id != "" && b.sessionID == "" {
		b.sessionID = id
	}
	body, err := io.ReadAll(answer.Body)
	if err != nil {
		b.fail(message, err)
		return
	}
	if answer.StatusCode >= 300 {
		b.fail(message, fmt.Errorf("Zasper answered %s: %s", answer.Status, strings.TrimSpace(string(body))))
		return
	}
	if body = bytes.TrimSpace(body); len(body) > 0 {
		var answer struct {
			Result struct {
				ProtocolVersion string `json:"protocolVersion"`
			} `json:"result"`
		}
		if json.Unmarshal(body, &answer) == nil && answer.Result.ProtocolVersion != "" {
			b.version = answer.Result.ProtocolVersion
		}
		b.write(body)
	}
}

// versionOf is the protocol version a message is sent under: the one it names in its _meta, as a
// client probing a newer protocol does, or else the one initialize agreed.
func versionOf(message []byte, agreed string) string {
	var request struct {
		Params struct {
			Meta map[string]any `json:"_meta"`
		} `json:"params"`
	}
	if json.Unmarshal(message, &request) == nil {
		if version, ok := request.Params.Meta["io.modelcontextprotocol/protocolVersion"].(string); ok {
			return version
		}
	}
	return agreed
}

// fail answers a request that could not be relayed with a JSON-RPC error, so the agent is not left
// waiting. A notification has no id and is answered by nothing.
func (b *Bridge) fail(message []byte, err error) {
	var request struct {
		ID json.RawMessage `json:"id"`
	}
	if json.Unmarshal(message, &request) != nil || len(request.ID) == 0 {
		fmt.Fprintln(os.Stderr, "zasper mcp:", err)
		return
	}
	answer, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      request.ID,
		"error":   map[string]any{"code": -32603, "message": err.Error()},
	})
	b.write(answer)
}

func (b *Bridge) write(line []byte) {
	b.writing.Lock()
	defer b.writing.Unlock()
	b.out.Write(append(line, '\n'))
}

// end closes the MCP session on the server, when there is one.
func (b *Bridge) end(ctx context.Context) {
	if b.sessionID == "" {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, b.server.URL+"/mcp", nil)
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+b.session)
	req.Header.Set("Mcp-Session-Id", b.sessionID)
	if answer, err := b.client.Do(req); err == nil {
		answer.Body.Close()
	}
}

// headersOf is the method, and for a call the name of what is called, that a request repeats in headers.
func headersOf(message []byte) map[string]string {
	var request struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params struct {
			Name string `json:"name"`
			URI  string `json:"uri"`
		} `json:"params"`
	}
	if json.Unmarshal(message, &request) != nil || request.Method == "" || len(request.ID) == 0 {
		return nil
	}
	headers := map[string]string{"Mcp-Method": request.Method}
	switch request.Method {
	case "tools/call", "prompts/get":
		headers["Mcp-Name"] = request.Params.Name
	case "resources/read":
		headers["Mcp-Name"] = request.Params.URI
	}
	return headers
}
