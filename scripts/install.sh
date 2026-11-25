#!/bin/sh
# Installs Zasper from its GitHub Release.
#
#   curl -fsSL https://zasper.io/install.sh | sh
#
# ZASPER_VERSION     a release to install, such as 2.1.0 (default: the latest)
# ZASPER_INSTALL_DIR where to put the binary (default: /usr/local/bin, or ~/.local/bin without root)
#
# POSIX sh, not bash: `| sh` is dash on Debian and Ubuntu, and busybox on Alpine.

set -eu

REPO="https://github.com/zasper-io/zasper"
# Test hooks: scripts/install_test.sh points both at a local server, which is why only they allow http.
DOWNLOAD_BASE="${ZASPER_DOWNLOAD_BASE:-$REPO/releases/download}"
LATEST_URL="${ZASPER_LATEST_URL:-https://zasper.io/latest.json}"
HTTPS_ONLY=1
if [ -n "${ZASPER_DOWNLOAD_BASE:-}${ZASPER_LATEST_URL:-}" ]; then HTTPS_ONLY=0; fi

say() { printf '%s\n' "$*"; }
fail() {
	printf 'zasper install: %s\n' "$*" >&2
	exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

fetch() {
	if has curl; then
		if [ "$HTTPS_ONLY" = 1 ]; then
			curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$2" "$1"
		else
			curl -fsSL -o "$2" "$1"
		fi
	elif has wget; then
		# Busybox's wget, Alpine's only downloader, has no --https-only.
		if [ "$HTTPS_ONLY" = 1 ] && wget --help 2>&1 | grep -q -- --https-only; then
			wget -q --https-only -O "$2" "$1"
		else
			wget -q -O "$2" "$1"
		fi
	else
		fail "needs curl or wget"
	fi
}

sha256() {
	if has sha256sum; then
		sha256sum "$1" | cut -d' ' -f1
	elif has shasum; then
		shasum -a 256 "$1" | cut -d' ' -f1
	else
		fail "needs sha256sum or shasum to check the download"
	fi
}

detect_os() {
	case "$(uname -s)" in
	Linux) echo linux ;;
	Darwin) echo darwin ;;
	MINGW* | MSYS* | CYGWIN*) fail "on Windows, download the .zip from $REPO/releases" ;;
	*) fail "no build for $(uname -s); see $REPO/releases" ;;
	esac
}

detect_arch() {
	case "$(uname -m)" in
	x86_64 | amd64) echo amd64 ;;
	aarch64 | arm64) echo arm64 ;;
	i386 | i686) echo 386 ;;
	*) fail "no build for $(uname -m); see $REPO/releases" ;;
	esac
}

# Rosetta reports x86_64 to a shell running under it, which would install the Intel build on Apple Silicon.
detect_darwin_arch() {
	if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then
		echo arm64
	else
		detect_arch
	fi
}

# latest.json, not GitHub's latest release: it is what running servers are told, and never a pre-release.
latest_version() {
	fetch "$LATEST_URL" "$1/latest.json" || fail "could not reach $LATEST_URL; set ZASPER_VERSION to install a release by number"
	version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/latest.json" | head -n 1)
	[ -n "$version" ] || fail "could not read a version from $LATEST_URL"
	echo "$version"
}

choose_dir() {
	if [ -n "${ZASPER_INSTALL_DIR:-}" ]; then
		echo "$ZASPER_INSTALL_DIR"
	elif [ "$(id -u)" = 0 ] || [ -w /usr/local/bin ] || has sudo; then
		echo /usr/local/bin
	else
		echo "$HOME/.local/bin"
	fi
}

install_binary() {
	src=$1
	dir=$2
	if mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ]; then
		install -m 755 "$src" "$dir/zasper"
	elif has sudo; then
		say "Installing to $dir needs sudo."
		sudo mkdir -p "$dir"
		sudo install -m 755 "$src" "$dir/zasper"
	else
		fail "cannot write to $dir; set ZASPER_INSTALL_DIR to a folder you own"
	fi
}

main() {
	for tool in tar gzip; do
		has "$tool" || fail "needs $tool; install it with your package manager, such as \`dnf install tar gzip\`"
	done
	has uname || fail "needs uname"

	os=$(detect_os)
	if [ "$os" = darwin ]; then arch=$(detect_darwin_arch); else arch=$(detect_arch); fi

	tmp=$(mktemp -d 2>/dev/null || mktemp -d -t zasper)
	trap 'rm -rf "$tmp"' EXIT
	trap 'exit 130' INT TERM

	version=${ZASPER_VERSION:-$(latest_version "$tmp")}
	version=${version#v}

	archive="zasper-webapp-$version-$os-$arch.tar.gz"
	sums="zasper_${version}_checksums.txt"

	say "Downloading Zasper $version for $os/$arch"
	fetch "$DOWNLOAD_BASE/v$version/$sums" "$tmp/$sums" || fail "no release $version at $REPO/releases"
	fetch "$DOWNLOAD_BASE/v$version/$archive" "$tmp/$archive" || fail "release $version has no $archive"

	want=$(awk -v f="$archive" '$2 == f { print $1 }' "$tmp/$sums")
	[ -n "$want" ] || fail "$sums does not list $archive"
	got=$(sha256 "$tmp/$archive")
	[ "$want" = "$got" ] || fail "checksum mismatch for $archive: expected $want, got $got"

	tar -xzf "$tmp/$archive" -C "$tmp" zasper

	dir=$(choose_dir)
	install_binary "$tmp/zasper" "$dir"
	say "Installed Zasper $("$dir/zasper" --version 2>/dev/null || echo "$version") to $dir/zasper"

	found=$(command -v zasper 2>/dev/null || true)
	if [ -z "$found" ]; then
		say ""
		say "$dir is not on your PATH. Add it with:"
		say "  export PATH=\"$dir:\$PATH\""
	elif ! [ "$found" -ef "$dir/zasper" ]; then
		say ""
		say "Note: \`zasper\` runs $found, which comes before $dir on your PATH."
	fi

	if ! { has python3 && python3 -c 'import ipykernel' >/dev/null 2>&1; }; then
		say ""
		say "Zasper runs notebooks on a Jupyter kernel. Install one with:"
		say "  pip install ipykernel"
	fi

	say ""
	say "Start it in your project folder with: zasper"
	if [ -n "${SSH_CONNECTION:-}" ]; then
		say "Over SSH, run \`zasper --no-browser\` and reach it from your machine through a tunnel:"
		say "  ssh -L 8048:localhost:8048 <this-host>"
	fi
}

main "$@"
