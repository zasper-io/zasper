package mcpbridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zasper-io/zasper/internal/runtimeinfo"
)

func everyoneAlive(runtimeinfo.Info) bool { return true }

func TestTheServerForTheProjectYouAreInIsChosen(t *testing.T) {
	servers := []runtimeinfo.Info{
		{URL: "http://a", Project: "/work"},
		{URL: "http://b", Project: "/work/drift"},
		{URL: "http://c", Project: "/elsewhere"},
	}

	chosen, err := Find("/work/drift/notebooks", servers, everyoneAlive)

	require.NoError(t, err)
	assert.Equal(t, "http://b", chosen.URL, "the deepest project holding the folder wins")
}

func TestTheOnlyServerRunningIsChosenFromAnywhere(t *testing.T) {
	servers := []runtimeinfo.Info{{URL: "http://a", Project: "/work"}, {URL: "http://gone", Project: "/old"}}

	chosen, err := Find("/tmp", servers, func(server runtimeinfo.Info) bool { return server.URL == "http://a" })

	require.NoError(t, err)
	assert.Equal(t, "http://a", chosen.URL)
}

func TestSeveralServersAndNoneForTheFolderIsAQuestion(t *testing.T) {
	_, err := Find("/tmp", []runtimeinfo.Info{{URL: "http://a", Project: "/one"}, {URL: "http://b", Project: "/two"}}, everyoneAlive)

	assert.ErrorContains(t, err, "/one, /two")
}

func TestNoServerRunningSaysHowToStartOne(t *testing.T) {
	_, err := Find("/work", []runtimeinfo.Info{{URL: "http://gone", Project: "/work"}}, func(runtimeinfo.Info) bool { return false })

	assert.ErrorContains(t, err, "start one with `zasper`")
}

func TestARequestSaysTheProtocolVersionItIsSentUnder(t *testing.T) {
	probe := []byte(`{"jsonrpc":"2.0","id":"p","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}`)
	call := []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)

	assert.Equal(t, "2026-07-28", versionOf(probe, "2025-11-25"), "a probe names its own")
	assert.Equal(t, "2025-11-25", versionOf(call, "2025-11-25"), "anything else is sent under the one agreed")
	assert.Equal(t, "", versionOf(call, ""), "nothing is said before initialize has agreed one")
}

func TestARequestRepeatsItsMethodAndWhatItCallsInHeaders(t *testing.T) {
	assert.Equal(t, map[string]string{"Mcp-Method": "tools/call", "Mcp-Name": "run_cell"},
		headersOf([]byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_cell","arguments":{}}}`)))
	assert.Equal(t, map[string]string{"Mcp-Method": "server/discover"},
		headersOf([]byte(`{"jsonrpc":"2.0","id":"p","method":"server/discover","params":{}}`)))
	assert.Nil(t, headersOf([]byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)), "a notification is a request of nobody's")
}
