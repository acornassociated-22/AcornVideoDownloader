#!/usr/bin/env bash
# Shared environment for Acorn scripts (sourced, not run directly).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Rust toolchain
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

PREFIX="${TAURI_DEPS_PREFIX:-$HOME/.local/tauri-deps}"
LOCAL_LIB="$PREFIX/usr/lib/x86_64-linux-gnu"
SYS_LIB="/usr/lib/x86_64-linux-gnu"
# User-owned work dir (avoids root-owned leftovers in /tmp after failed sudo)
ACORN_TMP="${ACORN_TMP:-${XDG_RUNTIME_DIR:-$HOME/.cache}/acorn-build}"
PCSTUB_DIR="$ACORN_TMP/pcstub"

# Ensure a writable per-user temp directory for link tests / pkg stubs.
ensure_acorn_tmp() {
  mkdir -p "$ACORN_TMP" "$PCSTUB_DIR" 2>/dev/null || {
    ACORN_TMP="$(mktemp -d "${TMPDIR:-/tmp}/acorn-build.XXXXXX")"
    PCSTUB_DIR="$ACORN_TMP/pcstub"
    mkdir -p "$PCSTUB_DIR"
  }
}

apply_linux_lib_env() {
  ensure_acorn_tmp

  if [ ! -f "$PCSTUB_DIR/krb5-gssapi.pc" ]; then
    printf '%s\n' \
      'Name: krb5-gssapi' \
      'Description: stub' \
      'Version: 1.22' \
      'Libs: -lgssapi_krb5' \
      'Cflags:' > "$PCSTUB_DIR/krb5-gssapi.pc"
  fi

  # Soften libsoup private krb5 requirement in local prefix
  SOUP_PC="$LOCAL_LIB/pkgconfig/libsoup-3.0.pc"
  if [ -f "$SOUP_PC" ] && grep -q 'krb5-gssapi' "$SOUP_PC" 2>/dev/null; then
    sed -i 's/ krb5-gssapi//g; s/Requires\.private:.*/Requires.private:/' "$SOUP_PC" || true
  fi

  if [ -d "$LOCAL_LIB/pkgconfig" ]; then
    export PKG_CONFIG_PATH="$PCSTUB_DIR:$LOCAL_LIB/pkgconfig:$PREFIX/usr/share/pkgconfig:${PKG_CONFIG_PATH:-}"
    export CPATH="$PREFIX/usr/include:${CPATH:-}"
  fi

  # Local first (has .so → .so.0), then system (has real .so.0)
  export LIBRARY_PATH="$LOCAL_LIB:$SYS_LIB:${LIBRARY_PATH:-}"
  export LD_LIBRARY_PATH="$LOCAL_LIB:$SYS_LIB:${LD_LIBRARY_PATH:-}"

  # Host-only rustflags — avoid polluting global RUSTFLAGS.
  local host_flags="-L native=${LOCAL_LIB} -L native=${SYS_LIB} -C link-arg=-Wl,-rpath-link,${LOCAL_LIB} -C link-arg=-Wl,-rpath-link,${SYS_LIB}"
  if [[ "${CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS:-}" != *"$LOCAL_LIB"* ]]; then
    export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS="${CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS:+${CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS} }${host_flags}"
  fi
  # Remove legacy global pollution if present from older script versions.
  if [[ "${RUSTFLAGS:-}" == *"$LOCAL_LIB"* ]] || [[ "${RUSTFLAGS:-}" == *rpath-link* ]]; then
    unset RUSTFLAGS
  fi
  unset CARGO_ENCODED_RUSTFLAGS
}

# Strip desktop GTK/WebKit link flags from the environment when needed.
clear_desktop_linux_lib_env() {
  unset RUSTFLAGS
  unset CARGO_ENCODED_RUSTFLAGS
  unset CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS
  unset LIBRARY_PATH
  unset LD_LIBRARY_PATH
  unset PKG_CONFIG_PATH
  unset CPATH
}

# Desktop-only host link helpers.
# (Do not auto-apply here — it breaks NDK aarch64 linking.)

ensure_node_modules() {
  if [ ! -d "$ROOT/node_modules" ]; then
    echo "==> npm install"
    npm install
  fi
}

ensure_tools() {
  command -v node >/dev/null || { echo "Node.js gerekli"; exit 1; }
  command -v npm >/dev/null || { echo "npm gerekli"; exit 1; }
}

# Return 0 if critical -l libs resolve for the linker.
verify_link_libs() {
  local libdir="$LOCAL_LIB"
  local fail=0
  local lib so real src out work

  ensure_acorn_tmp
  work="$(mktemp -d "$ACORN_TMP/verify-XXXXXX")"
  src="$work/link.c"
  out="$work/link"
  echo 'int main(){return 0;}' > "$src"

  for lib in gdk-3 gtk-3 webkit2gtk-4.1; do
    so="$libdir/lib${lib}.so"
    if [ -e "$so" ]; then
      real="$(readlink -f "$so" 2>/dev/null || true)"
      if [ -z "$real" ] || [ ! -e "$real" ]; then
        fail=1
        continue
      fi
    elif [ ! -e "$SYS_LIB/lib${lib}.so" ] && [ ! -e "$SYS_LIB/lib${lib}.so.0" ]; then
      fail=1
      continue
    fi

    if ! cc -L"$LOCAL_LIB" -L"$SYS_LIB" -l"$lib" -o "$out" "$src" 2>/dev/null; then
      fail=1
    fi
    rm -f "$out"
  done

  rm -rf "$work"
  return "$fail"
}

ensure_linux_build_deps() {
  if ! command -v pkg-config >/dev/null; then
    echo "pkg-config bulunamadı."
    exit 1
  fi

  apply_linux_lib_env

  local pkg_ok=0
  local link_ok=0
  if pkg-config --exists dbus-1 && pkg-config --exists webkit2gtk-4.1; then
    pkg_ok=1
  fi
  if verify_link_libs; then
    link_ok=1
  fi

  if [ "$pkg_ok" -eq 1 ] && [ "$link_ok" -eq 1 ]; then
    return 0
  fi

  echo "==> Linux bağımlılıkları eksik veya link kütüphaneleri kırık — otomatik kurulum…"
  if ! bash "$ROOT/scripts/setup-linux-deps.sh"; then
    echo ""
    echo "HATA: Linux derleme/link bağımlılıkları kurulamadı."
    echo ""
    echo "Sudo ile sistem paketlerini kurun:"
    echo "  sudo apt install -y libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libdbus-1-dev pkg-config build-essential"
    echo ""
    echo "Sonra: npm start   veya   ./scripts/run.sh"
    exit 1
  fi

  apply_linux_lib_env

  if ! pkg-config --exists dbus-1 || ! pkg-config --exists webkit2gtk-4.1; then
    echo "HATA: pkg-config hâlâ başarısız (dbus / webkit2gtk)."
    pkg-config --print-errors webkit2gtk-4.1 2>&1 | head -8 || true
    exit 1
  fi

  if ! verify_link_libs; then
    echo "HATA: Linker hâlâ -lgdk-3 / -lgtk-3 / -lwebkit2gtk-4.1 bulamıyor."
    echo "Sudo ile: sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libdbus-1-dev"
    exit 1
  fi
}
