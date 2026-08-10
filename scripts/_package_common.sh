# Shared helpers for platform packaging scripts (source, do not run).
# Expects scripts/_env.sh already sourced (ROOT set).

BIN_DIR="${ROOT}/src-tauri/binaries"
BUNDLE_ROOT="${ROOT}/src-tauri/target/release/bundle"

package_require_cargo() {
  if ! command -v cargo >/dev/null; then
    echo "Rust/cargo bulunamadı. Kurulum: curl https://sh.rustup.rs -sSf | sh"
    exit 1
  fi
}

package_require_host() {
  local want="$1"
  local os
  os="$(uname -s 2>/dev/null || echo unknown)"
  case "$want" in
    linux)
      if [[ "$os" != "Linux" ]]; then
        echo "HATA: Linux .deb paketi yalnızca Linux host’ta üretilir (şu an: $os)."
        exit 1
      fi
      ;;
    windows)
      case "$os" in
        MINGW*|MSYS*|CYGWIN*) ;;
        *)
          if [[ "${OS:-}" != "Windows_NT" ]]; then
            echo "HATA: Windows nsis/msi paketi yalnızca Windows host’ta üretilir (şu an: $os)."
            echo "      Bu makinede çapraz derleme desteklenmiyor."
            exit 1
          fi
          ;;
      esac
      ;;
    macos)
      if [[ "$os" != "Darwin" ]]; then
        echo "HATA: macOS .dmg paketi yalnızca macOS host’ta üretilir (şu an: $os)."
        exit 1
      fi
      ;;
    *)
      echo "HATA: bilinmeyen host hedefi: $want"
      exit 1
      ;;
  esac
}

# Require Tauri externalBin sidecars for a rustc target triple suffix.
# Names: acorn-yt-dlp-<triple>, acorn-ffmpeg-<triple> (must be real files, not /usr/bin symlinks).
package_require_sidecars() {
  local triple="$1"
  local missing=0
  local name path

  for name in acorn-yt-dlp acorn-ffmpeg; do
    path="${BIN_DIR}/${name}-${triple}"
    if [[ ! -e "$path" ]]; then
      echo "EKSİK sidecar: binaries/${name}-${triple}"
      missing=1
      continue
    fi
    # Refuse packaging symlinks into /usr/bin — that overwrites distro packages.
    if [[ -L "$path" ]]; then
      local target
      target="$(readlink -f "$path" 2>/dev/null || readlink "$path")"
      if [[ "$target" == /usr/bin/* || "$target" == /bin/* ]]; then
        echo "HATA: $path → $target (sistem binary symlink'i paketlenemez)"
        missing=1
      fi
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    echo ""
    echo "HATA: Paketleme için hedef sidecars eksik/geçersiz: $triple"
    echo "      Çalıştır: ./scripts/prepare-desktop-binaries.sh $triple"
    exit 1
  fi
}

package_build_frontend() {
  ensure_tools
  ensure_node_modules
  package_require_cargo
  echo "==> Frontend build"
  npm run build
}

package_print_bundle_dir() {
  local sub="$1"
  local dir="${BUNDLE_ROOT}/${sub}"
  local f
  echo ""
  echo "==> Paket çıktısı:"
  if [[ -d "$dir" ]]; then
    echo "   $dir"
    while IFS= read -r f; do
      echo "   - $f"
    done < <(find "$dir" -maxdepth 2 -type f \( -name '*.deb' -o -name '*.exe' -o -name '*.msi' -o -name '*.dmg' -o -name '*.AppImage' \) 2>/dev/null | sort)
  else
    echo "   (klasör henüz yok) beklenen: $dir"
  fi
}

# After Linux .deb build:
# - delete Tauri staging dirs that share the .deb basename (without .deb)
#   so `dpkg -i …_amd64` cannot pick a directory by mistake
# - publish a space-free copy under releases/
package_finalize_linux_deb() {
  local deb_dir="${BUNDLE_ROOT}/deb"
  local releases_dir="${ROOT}/releases"
  local f base stem ver_arch safe dest
  local found=0

  mkdir -p "$releases_dir"

  if [[ ! -d "$deb_dir" ]]; then
    echo "HATA: deb klasörü yok: $deb_dir"
    return 1
  fi

  while IFS= read -r f; do
    found=1
    base="$(basename "$f")"
    stem="${base%.deb}"

    # Remove staging directory named like the .deb without extension.
    if [[ -d "${deb_dir}/${stem}" ]]; then
      echo "==> Karışıklık önleme: staging klasörü siliniyor → ${stem}/"
      rm -rf "${deb_dir}/${stem}"
    fi

    ver_arch="$(echo "$base" | sed -E 's/^.*_([0-9]+\.[0-9]+\.[0-9]+_[^.]+\.deb)$/\1/')"
    if [[ "$ver_arch" == "$base" ]]; then
      ver_arch="$base"
    fi
    safe="acorn-video-downloader_${ver_arch}"
    # Ensure .deb suffix
    case "$safe" in
      *.deb) ;;
      *) safe="${safe}.deb" ;;
    esac

    dest="${releases_dir}/${safe}"
    cp -f "$f" "${deb_dir}/${safe}"
    cp -f "$f" "$dest"

    echo ""
    echo "==> Kurulum dosyası hazır (.deb — klasör değil):"
    echo "   $dest"
    echo ""
    echo "Kur:"
    echo "  sudo dpkg -i \"$dest\""
    echo ""
    echo "veya:"
    echo "  cd \"$releases_dir\" && sudo dpkg -i ${safe}"
  done < <(find "$deb_dir" -maxdepth 1 -type f -name '*.deb' ! -name 'acorn-video-downloader_*.deb' 2>/dev/null | sort)

  # Also handle already-renamed copies if Tauri name was already safe
  if [[ "$found" -eq 0 ]]; then
    while IFS= read -r f; do
      found=1
      base="$(basename "$f")"
      stem="${base%.deb}"
      if [[ -d "${deb_dir}/${stem}" ]]; then
        echo "==> Karışıklık önleme: staging klasörü siliniyor → ${stem}/"
        rm -rf "${deb_dir}/${stem}"
      fi
      dest="${releases_dir}/${base}"
      cp -f "$f" "$dest"
      echo ""
      echo "==> Kurulum dosyası:"
      echo "   $dest"
      echo "  sudo dpkg -i \"$dest\""
    done < <(find "$deb_dir" -maxdepth 1 -type f -name 'acorn-video-downloader_*.deb' 2>/dev/null | sort)
  fi

  if [[ "$found" -eq 0 ]]; then
    echo "HATA: .deb dosyası bulunamadı: $deb_dir"
    return 1
  fi
}

package_run_tauri_build() {
  local bundles="$1"
  echo "==> Tauri build --bundles ${bundles}"
  npx tauri build --bundles "$bundles"
}
