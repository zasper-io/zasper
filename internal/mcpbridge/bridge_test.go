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
