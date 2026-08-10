#!/usr/bin/env bash
# Download/extract Tauri Linux build deps into $HOME/.local/tauri-deps (no sudo).
# Fills both -dev headers/pkg-config AND runtime .so.0 libraries so linking works.
set -euo pipefail

PREFIX="${TAURI_DEPS_PREFIX:-$HOME/.local/tauri-deps}"
CACHE="${TMPDIR:-/tmp}/acorn-tauri-debs"
LIBDIR="$PREFIX/usr/lib/x86_64-linux-gnu"
PCDIR="$LIBDIR/pkgconfig"
ACORN_TMP="${ACORN_TMP:-${XDG_RUNTIME_DIR:-$HOME/.cache}/acorn-build}"
PCSTUB_DIR="$ACORN_TMP/pcstub"

mkdir -p "$PREFIX" "$CACHE" "$PCDIR" "$PCSTUB_DIR"

echo "==> Linux bağımlılıkları → $PREFIX"

# Core packages: headers/pkg-config + runtime shared objects
PACKAGES=(
  # Dev
  libwebkit2gtk-4.1-dev
  libjavascriptcoregtk-4.1-dev
  libsoup-3.0-dev
  libgtk-3-dev
  libglib2.0-dev
  libpango1.0-dev
  libcairo2-dev
  libgdk-pixbuf-2.0-dev
  libatk1.0-dev
  libatk-bridge2.0-dev
  libatspi2.0-dev
  libharfbuzz-dev
  libdbus-1-dev
  librsvg2-dev
  libayatana-appindicator3-dev
  libepoxy-dev
  libfribidi-dev
  libfontconfig-dev
  libfreetype-dev
  libpng-dev
  libx11-dev
  libxext-dev
  libxi-dev
  libxrandr-dev
  libxfixes-dev
  libxcursor-dev
  libxdamage-dev
  libxcomposite-dev
  libxinerama-dev
  libxcb-render0-dev
  libxcb-shm0-dev
  libpixman-1-dev
  libthai-dev
  libdatrie-dev
  libwayland-dev
  libxkbcommon-dev
  libegl-dev
  libgl-dev
  libgraphene-1.0-dev
  libcloudproviders-dev
  libpsl-dev
  libnghttp2-dev
  libsystemd-dev
  libseccomp-dev
  libxml2-dev
  libsqlite3-dev
  libbrotli-dev
  libffi-dev
  zlib1g-dev
  libpcre2-dev
  libmount-dev
  libblkid-dev
  # Runtime (Ubuntu 24+/26 t64 names + fallbacks)
  libgtk-3-0t64
  libgtk-3-0
  libatk1.0-0t64
  libatk1.0-0
  libatk-bridge2.0-0t64
  libatk-bridge2.0-0
  libatspi2.0-0t64
  libwebkit2gtk-4.1-0
  libjavascriptcoregtk-4.1-0
  libsoup-3.0-0
  libdbus-1-3
  libpango-1.0-0
  libcairo2
  libcairo-gobject2
  libgdk-pixbuf-2.0-0
  libharfbuzz0b
  librsvg2-2
  libayatana-appindicator3-1
  libepoxy0
  libfribidi0
  libglib2.0-0t64
  libglib2.0-0
)

cd "$CACHE"
echo "==> apt-get download…"
# Download what exists; ignore missing alternate names
for pkg in "${PACKAGES[@]}"; do
  if ! ls "${pkg}"_*.deb >/dev/null 2>&1; then
    apt-get download "$pkg" >/dev/null 2>&1 || true
  fi
done

echo "==> dpkg-deb extract…"
shopt -s nullglob
for deb in "$CACHE"/*.deb; do
  dpkg-deb -x "$deb" "$PREFIX"
done
shopt -u nullglob

# Rewrite pkg-config prefix=/usr → local prefix
echo "==> pkg-config yolları düzeltiliyor…"
find "$PREFIX" -name '*.pc' -type f 2>/dev/null | while read -r pc; do
  sed -i "s|^prefix=/usr|prefix=$PREFIX/usr|g" "$pc" || true
done

# Soften libsoup private krb5 requirement
SOUP_PC="$PCDIR/libsoup-3.0.pc"
if [ -f "$SOUP_PC" ]; then
  sed -i 's/ krb5-gssapi//g; s/Requires\.private:.*/Requires.private:/' "$SOUP_PC" || true
fi

# Stub for packages that still Require krb5-gssapi
cat > "$PCSTUB_DIR/krb5-gssapi.pc" <<'EOF'
Name: krb5-gssapi
Description: stub
Version: 1.22
Libs: -lgssapi_krb5
Cflags:
EOF

# Repair broken -dev symlinks by pointing at system runtime libs when available
echo "==> Kırık symlink onarımı…"
SYS_LIB=/usr/lib/x86_64-linux-gnu
for so in "$LIBDIR"/*.so; do
  [ -L "$so" ] || continue
  target="$(readlink "$so")"
  # Relative target like libgdk-3.so.0
  if [[ "$target" != /* ]]; then
    resolved="$LIBDIR/$target"
  else
    resolved="$target"
  fi
  if [ ! -e "$resolved" ]; then
    base="$(basename "$resolved")"
    if [ -e "$SYS_LIB/$base" ]; then
      ln -sfn "$SYS_LIB/$base" "$so"
      echo "  fixed $(basename "$so") → $SYS_LIB/$base"
    elif [ -e "$SYS_LIB/$(basename "$so").0" ]; then
      ln -sfn "$SYS_LIB/$(basename "$so").0" "$so"
      echo "  fixed $(basename "$so") → system .so.0"
    fi
  fi
done

# Also copy/symlink missing versioned libs from system into prefix when -dev .so exists
for so in "$LIBDIR"/*.so; do
  [ -e "$so" ] || continue
  real="$(readlink -f "$so" 2>/dev/null || true)"
  if [ -z "$real" ] || [ ! -e "$real" ]; then
    name="$(basename "$so")"
    # Try system unversioned or .so.0
    if [ -e "$SYS_LIB/${name}.0" ]; then
      ln -sfn "$SYS_LIB/${name}.0" "$so"
      echo "  relink $name → $SYS_LIB/${name}.0"
    fi
  fi
done

export PKG_CONFIG_PATH="$PCSTUB_DIR:$PCDIR:$PREFIX/usr/share/pkgconfig:${PKG_CONFIG_PATH:-}"
export LIBRARY_PATH="$LIBDIR:$SYS_LIB:${LIBRARY_PATH:-}"
export LD_LIBRARY_PATH="$LIBDIR:$SYS_LIB:${LD_LIBRARY_PATH:-}"

echo "==> Link testi…"
FAIL=0
LINK_WORK="$(mktemp -d "$ACORN_TMP/link-XXXXXX")"
echo 'int main(){return 0;}' > "$LINK_WORK/link.c"
for lib in gdk-3 gtk-3 pangocairo-1.0 pango-1.0 gdk_pixbuf-2.0 cairo-gobject cairo webkit2gtk-4.1; do
  if cc -L"$LIBDIR" -L"$SYS_LIB" -l"$lib" -o "$LINK_WORK/link" "$LINK_WORK/link.c" 2>/dev/null; then
    echo "  OK  -l$lib"
  else
    echo "  FAIL -l$lib"
    FAIL=1
  fi
  rm -f "$LINK_WORK/link"
done
rm -rf "$LINK_WORK"

if ! pkg-config --exists dbus-1; then
  echo "  FAIL pkg-config dbus-1"
  FAIL=1
else
  echo "  OK  pkg-config dbus-1"
fi

if ! pkg-config --exists webkit2gtk-4.1; then
  echo "  FAIL pkg-config webkit2gtk-4.1"
  pkg-config --print-errors webkit2gtk-4.1 2>&1 | head -8 || true
  FAIL=1
else
  echo "  OK  pkg-config webkit2gtk-4.1"
fi

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "Bazı bağımlılıklar hâlâ eksik. Sudo varsa:"
  echo "  sudo apt install -y libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev libdbus-1-dev pkg-config build-essential"
  exit 1
fi

echo "==> Linux bağımlılıkları hazır"
