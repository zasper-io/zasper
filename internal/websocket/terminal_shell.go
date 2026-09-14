package websocket

import (
	"bufio"
	"io"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strings"
)

/*
shellFor picks the shell a terminal runs. $SHELL comes first, since it is what the user's own terminal
starts. Next is the login shell their account names, then /bin/sh, which every Unix has. A candidate that
is not an executable here is passed over, so a $SHELL naming a shell that is not installed does not leave
the terminal with nothing. loginShell is asked only when $SHELL will not do.
*/
func shellFor(getenv func(string) string, loginShell func() string) string {
	if path, ok := executable(getenv("SHELL")); ok {
		return path
	}
	if path, ok := executable(loginShell()); ok {
		return path
	}
	return "/bin/sh"
}

func executable(name string) (string, bool) {
	if name == "" {
		return "", false
	}
	path, err := exec.LookPath(name)
	return path, err == nil
}

// loginShell answers the shell the account database names for the user running Zasper, or "".
func loginShell() string {
	account, err := user.Current()
	if err != nil {
		return ""
	}

	if runtime.GOOS == "darwin" {
		// macOS keeps accounts in Directory Services; its /etc/passwd lists only system accounts.
		output, err := exec.Command("dscl", ".", "-read", "/Users/"+account.Username, "UserShell").Output()
		if err != nil {
			return ""
		}
		return dsclShell(string(output))
	}

	passwd, err := os.Open("/etc/passwd")
	if err != nil {
		return ""
	}
	defer passwd.Close()
	return passwdShell(passwd, account.Uid)
}

// passwdShell reads the shell field of the passwd(5) entry for uid.
func passwdShell(passwd io.Reader, uid string) string {
	lines := bufio.NewScanner(passwd)
	for lines.Scan() {
		fields := strings.Split(lines.Text(), ":")
		if len(fields) == 7 && fields[2] == uid {
			return fields[6]
		}
	}
	return ""
}

// dsclShell reads what `dscl . -read /Users/<name> UserShell` prints: "UserShell: /bin/zsh".
func dsclShell(output string) string {
	value, found := strings.CutPrefix(strings.TrimSpace(output), "UserShell:")
	if !found {
		return ""
	}
	return strings.TrimSpace(value)
}
