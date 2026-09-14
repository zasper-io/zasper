package store

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTheZeroMapIsReadyToUse(t *testing.T) {
	var kernels Map[string, int]

	_, found := kernels.Get("k1")
	assert.False(t, found)
	assert.Empty(t, kernels.Values())

	kernels.Set("k1", 1)
	value, found := kernels.Get("k1")
	assert.True(t, found)
	assert.Equal(t, 1, value)
}

func TestOnlyOneTakerGetsAValue(t *testing.T) {
	var kernels Map[string, int]
	kernels.Set("k1", 1)

	var takers sync.WaitGroup
	var mu sync.Mutex
	won := 0
	for range 20 {
		takers.Add(1)
		go func() {
			defer takers.Done()
			if _, ok := kernels.Take("k1"); ok {
				mu.Lock()
				won++
				mu.Unlock()
			}
		}()
	}
	takers.Wait()

	assert.Equal(t, 1, won)
}

func TestUpdateChangesOnlyWhatIsThere(t *testing.T) {
	var kernels Map[string, int]
	kernels.Set("k1", 1)

	assert.True(t, kernels.Update("k1", func(v *int) { *v = 2 }))
	assert.False(t, kernels.Update("gone", func(v *int) { *v = 3 }))

	assert.Equal(t, map[string]int{"k1": 2}, kernels.Snapshot())
}

func TestASnapshotIsACopy(t *testing.T) {
	var kernels Map[string, int]
	kernels.Set("k1", 1)

	snapshot := kernels.Snapshot()
	snapshot["k2"] = 2

	_, found := kernels.Get("k2")
	assert.False(t, found)
}

func TestWithAndClear(t *testing.T) {
	var sessions Map[string, string]
	sessions.With(func(m map[string]string) {
		m["s1"] = "a.ipynb"
		m["s2"] = "b.ipynb"
	})
	assert.ElementsMatch(t, []string{"a.ipynb", "b.ipynb"}, sessions.Values())

	sessions.Clear()
	assert.Empty(t, sessions.Snapshot())
}
