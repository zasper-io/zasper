#!/bin/sh
# Tests scripts/install.sh against a fake release served from a local folder. Needs python3.
#
#   sh scripts/install_test.sh            # with the system sh
#   dash scripts/install_test.sh          # as `curl | sh` runs on Debian and Ubuntu

set -eu

here=$(cd "$(dirname "$0")" && pwd)
installer="$here/install.sh"
shell=${TEST_SHELL:-sh}

work=$(mktemp -d)
server_pid=
cleanup() {
	if [ -n "$server_pid" ]; then
		kill "$server_pid" 2>/dev/null
		wait "$server_pid" 2>/dev/null || true
	fi
	rm -rf "$work"
}
trap cleanup EXIT

case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "skip: $(uname -s)"; exit 0 ;; esac
case "$(uname -m)" in x86_64 | amd64) arch=amd64 ;; aarch64 | arm64) arch=arm64 ;; i?86) arch=386 ;; esac
if [ "$os" = darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

release() {
	v=$1
	dir="$work/site/v$v"
	mkdir -p "$dir" "$work/build"
	printf '#!/bin/sh\necho %s\n' "$v" >"$work/build/zasper"
	chmod +x "$work/build/zasper"
	tar -czf "$dir/zasper-webapp-$v-$os-$arch.tar.gz" -C "$work/build" zasper
	printf '%s  zasper-webapp-%s-%s-%s.tar.gz\n' \
		"$(sha "$dir/zasper-webapp-$v-$os-$arch.tar.gz")" "$v" "$os" "$arch" >"$dir/zasper_${v}_checksums.txt"
}

release 1.2.3
release 1.2.4
printf '{\n  "version": "1.2.4",\n  "minimum": "1.0.0"\n}\n' >"$work/site/latest.json"

# A release whose archive no longer matches its checksum.
release 6.6.6
printf 'tampered' >>"$work/site/v6.6.6/zasper-webapp-6.6.6-$os-$arch.tar.gz"

port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$work/site" >/dev/null 2>&1 &
server_pid=$!
base="http://127.0.0.1:$port"
i=0
until python3 -c "import urllib.request; urllib.request.urlopen('$base/latest.json')" 2>/dev/null; do
	i=$((i + 1))
	[ "$i" -lt 50 ] || { echo "server did not start"; exit 1; }
	sleep 0.1
done

failures=0
run() {
	# run <name> <install dir> [VAR=value...]
	name=$1
	target=$2
	shift 2
	env ZASPER_DOWNLOAD_BASE="$base" ZASPER_LATEST_URL="$base/latest.json" ZASPER_INSTALL_DIR="$target" "$@" \
		"$shell" "$installer" >"$work/$name.out" 2>&1
}
pass() { echo "ok   $1"; }
flunk() {
	echo "FAIL $1"
	sed 's/^/     /' "$work/$1.out"
	failures=$((failures + 1))
}

t=latest
if run $t "$work/bin-$t" && [ "$("$work/bin-$t/zasper")" = 1.2.4 ]; then pass $t; else flunk $t; fi

t=pinned
if run $t "$work/bin-$t" ZASPER_VERSION=1.2.3 && [ "$("$work/bin-$t/zasper")" = 1.2.3 ]; then pass $t; else flunk $t; fi

t=pinned-with-v
if run $t "$work/bin-$t" ZASPER_VERSION=v1.2.3 && [ "$("$work/bin-$t/zasper")" = 1.2.3 ]; then pass $t; else flunk $t; fi

t=upgrade-in-place
mkdir -p "$work/bin-$t"
run $t "$work/bin-$t" ZASPER_VERSION=1.2.3 || true
if run $t "$work/bin-$t" && [ "$("$work/bin-$t/zasper")" = 1.2.4 ]; then pass $t; else flunk $t; fi

t=checksum-mismatch
if ! run $t "$work/bin-$t" ZASPER_VERSION=6.6.6 && grep -q 'checksum mismatch' "$work/$t.out" &&
	[ ! -e "$work/bin-$t/zasper" ]; then pass $t; else flunk $t; fi

t=no-such-release
if ! run $t "$work/bin-$t" ZASPER_VERSION=0.0.1 && grep -q 'no release 0.0.1' "$work/$t.out"; then
	pass $t
else flunk $t; fi

t=latest-unreachable
if ! run $t "$work/bin-$t" ZASPER_LATEST_URL="$base/missing.json" && grep -q 'set ZASPER_VERSION' "$work/$t.out"; then
	pass $t
else flunk $t; fi

[ "$failures" = 0 ] || { echo "$failures failed"; exit 1; }
