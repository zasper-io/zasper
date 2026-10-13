package kernel

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"os"
	"path/filepath"

	"github.com/go-zeromq/zmq4"
	"github.com/rs/zerolog/log"
)

/*
How a dial waits for a kernel's ports.

zmq4 dials once, retrying a refused endpoint a set number of times, and then hands back a socket with
nothing behind it and no way to get anything: the connection is silently dead. A kernel binds its ports
whenever it is ready to, which for a cold JVM, Julia or .NET kernel is well past any fixed budget. So
the server's own watch on a kernel dials patiently, retrying until the kernel binds or its context ends
with the kernel, and everything else waits for that watch to hear the kernel (KernelManager.Up) before
dialling at all. By then the ports are bound, and dialBudget is only for a channel the kernel does not
have, such as IRuby's control.
*/
const (
	dialRetryInterval = 250 * time.Millisecond
	dialBudget        = 5 * time.Second
	// AnswerBudget is how long a client waits for a kernel that is up to answer it, before carrying on
	// without an answer: the client then sees a kernel that does not answer, which is what it has.
	AnswerBudget = 30 * time.Second
)

// dialOptions is the retry policy above, plus whatever else the socket asking for it needs.
func dialOptions(patient bool, opts ...zmq4.Option) []zmq4.Option {
	retries := int(dialBudget / dialRetryInterval)
	if patient {
		retries = -1
	}
	return append(opts, zmq4.WithDialerRetry(dialRetryInterval), zmq4.WithDialerMaxRetries(retries))
}

// Connection is where a kernel's sockets are: the transport, the address and a port per channel.
type Connection struct {
	IP        string
	Transport string

	HbPort      int
	ShellPort   int
	IopubPort   int
	StdinPort   int
	ControlPort int
}

type ConnectionFileData struct {
	Transport       string `json:"transport"`
	IP              string `json:"ip"`
	Key             string `json:"key"`
	StdinPort       int    `json:"stdin_port"`
	IopubPort       int    `json:"iopub_port"`
	ShellPort       int    `json:"shell_port"`
	HbPort          int    `json:"hb_port"`
	ControlPort     int    `json:"control_port"`
	SignatureScheme string `json:"signature_scheme"`
	KernelName      string `json:"kernel_name"`
}

/*
runtimeDir is where a kernel's connection file lives: ~/.zasper/runtime, owner-only.

These files used to go into os.TempDir() at mode 0644, and the file contains the kernel's HMAC
signing key. On any machine with more than one account that meant a local user could read the key
and inject signed messages into somebody else's kernel, which is code execution as them. Jupyter
keeps the same files 0600 in a private runtime directory, for the same reason.

A home directory that cannot be determined falls back to the temp dir, so a kernel still starts —
the file is still written 0600 either way.
*/
func runtimeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Warn().Err(err).Msg("no home directory; keeping kernel connection files in the temp dir")
		return os.TempDir()
	}

	dir := filepath.Join(home, ".zasper", "runtime")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		log.Warn().Err(err).Msgf("could not create %s; keeping kernel connection files in the temp dir", dir)
		return os.TempDir()
	}
	return dir
}

// removeConnectionFile deletes a kernel's connection file, which holds its signing key.
func removeConnectionFile(connectionFile string) {
	if connectionFile == "" {
		return
	}
	if err := os.Remove(connectionFile); err != nil && !os.IsNotExist(err) {
		log.Warn().Err(err).Msgf("could not remove the connection file at %s", connectionFile)
	}
}

func (km *KernelManager) writeConnectionFile(connectionFile string) error {
	// 0600 from the moment it exists rather than chmod'ed afterwards: the key is written into it
	// immediately, so a window at 0644 is a window where it can be read.
	file, err := os.OpenFile(connectionFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	// O_TRUNC leaves an existing file's mode alone, so a file from an older build stays 0644 without
	// this.
	if err := file.Chmod(0o600); err != nil {
		log.Warn().Err(err).Msgf("could not restrict the connection file at %s", connectionFile)
	}
	log.Debug().Msgf("writing connection info to %s", file.Name())
	defer file.Close()

	// Create a JSON encoder and set indentation for pretty-printing.
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "    ")

	data := ConnectionFileData{
		Transport:       km.ConnectionInfo.Transport,
		IP:              km.ConnectionInfo.IP,
		Key:             km.Session.Key,
		StdinPort:       km.ConnectionInfo.StdinPort,
		IopubPort:       km.ConnectionInfo.IopubPort,
		ShellPort:       km.ConnectionInfo.ShellPort,
		HbPort:          km.ConnectionInfo.HbPort,
		ControlPort:     km.ConnectionInfo.ControlPort,
		SignatureScheme: km.Session.SignatureScheme,
		KernelName:      km.KernelName,
	}

	// Encode the data as JSON and write it to the file.
	if err := encoder.Encode(data); err != nil {
		return fmt.Errorf("failed to encode JSON: %w", err)
	}

	return nil
}

func (conn *Connection) makeURL(channel string, port int) string {

	if conn.Transport == "tcp" {
		return fmt.Sprintf("tcp://%s:%d", conn.IP, port)
	}
	return fmt.Sprintf("%s://%s-%d", conn.Transport, conn.IP, port)
}

// dial connects socket to one of the kernel's channels. A socket that failed to dial is one nothing ever
// comes out of, so it is reported, unless the context ended first: then nobody wants it any more.
func (conn *Connection) dial(ctx context.Context, socket zmq4.Socket, channel string, port int) zmq4.Socket {
	if err := socket.Dial(conn.makeURL(channel, port)); err != nil && ctx.Err() == nil {
		log.Error().Str("channel", channel).Msgf("could not dial: %v", err)
	}
	return socket
}

// The Connect methods dial a kernel that is already up: see KernelManager.Up.
func (conn *Connection) ConnectShell(ctx context.Context, id zmq4.SocketIdentity) zmq4.Socket {
	return conn.connectShell(ctx, id, false)
}

func (conn *Connection) connectShell(ctx context.Context, id zmq4.SocketIdentity, patient bool) zmq4.Socket {
	return conn.dial(ctx, zmq4.NewDealer(ctx, dialOptions(patient, zmq4.WithID(id))...), "shell", conn.ShellPort)
}

func (conn *Connection) ConnectControl(ctx context.Context) zmq4.Socket {
	return conn.dial(ctx, zmq4.NewDealer(ctx, dialOptions(false)...), "control", conn.ControlPort)
}

func (conn *Connection) ConnectIopub(ctx context.Context) zmq4.Socket {
	return conn.connectIopub(ctx, false)
}

func (conn *Connection) connectIopub(ctx context.Context, patient bool) zmq4.Socket {
	socket := zmq4.NewSub(ctx, dialOptions(patient)...)
	if err := socket.SetOption(zmq4.OptionSubscribe, ""); err != nil {
		log.Error().Msgf("could not subscribe: %v", err)
	}
	return conn.dial(ctx, socket, "iopub", conn.IopubPort)
}

func (conn *Connection) ConnectStdin(ctx context.Context, id zmq4.SocketIdentity) zmq4.Socket {
	return conn.dial(ctx, zmq4.NewDealer(ctx, dialOptions(false, zmq4.WithID(id))...), "stdin", conn.StdinPort)
}

func (conn *Connection) ConnectHb(ctx context.Context) zmq4.Socket {
	return conn.dial(ctx, zmq4.NewReq(ctx, dialOptions(false)...), "hb", conn.HbPort)
}
