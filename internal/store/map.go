// Package store holds the server's running state — kernels, sessions, terminals — behind one kind of
// lock, so that no caller can reach a map without it.
package store

import "sync"

// Map is a map guarded by a read-write lock. The zero value is an empty map ready to use.
type Map[K comparable, V any] struct {
	mu sync.RWMutex
	m  map[K]V
}

func (s *Map[K, V]) Get(key K) (V, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	value, ok := s.m[key]
	return value, ok
}

func (s *Map[K, V]) Set(key K, value V) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.m == nil {
		s.m = map[K]V{}
	}
	s.m[key] = value
}

// Take removes key and answers what it held, and whether this call is the one that removed it: of two
// callers stopping the same kernel, only one goes on to signal its process.
func (s *Map[K, V]) Take(key K) (V, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	value, ok := s.m[key]
	if ok {
		delete(s.m, key)
	}
	return value, ok
}

// Update changes the value at key in place and reports whether there was one. A missing key is not
// added: a late message about a kernel that has just stopped must not put it back.
func (s *Map[K, V]) Update(key K, change func(*V)) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	value, ok := s.m[key]
	if !ok {
		return false
	}
	change(&value)
	s.m[key] = value
	return true
}

// Values answers a copy of every value, in no particular order.
func (s *Map[K, V]) Values() []V {
	s.mu.RLock()
	defer s.mu.RUnlock()

	values := make([]V, 0, len(s.m))
	for _, value := range s.m {
		values = append(values, value)
	}
	return values
}

// Snapshot answers a copy of the map, which the caller may walk as slowly as it likes.
func (s *Map[K, V]) Snapshot() map[K]V {
	s.mu.RLock()
	defer s.mu.RUnlock()

	copied := make(map[K]V, len(s.m))
	for key, value := range s.m {
		copied[key] = value
	}
	return copied
}

// With runs change on the map under the write lock, for a read-modify-write across several entries.
func (s *Map[K, V]) With(change func(m map[K]V)) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.m == nil {
		s.m = map[K]V{}
	}
	change(s.m)
}

func (s *Map[K, V]) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.m = map[K]V{}
}
