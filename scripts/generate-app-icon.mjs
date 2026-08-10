/**
 * Build a square branded app icon from src/assets/logo.svg and run `tauri icon`.
 * Uses /tmp for `tauri icon` because project paths with apostrophes break the CLI.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  mkdtempSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = join(root, "src/assets/logo.svg");
const outDir = join(root, "src-tauri");
const squarePngPath = join(outDir, "app-icon.png");
const iconsOut = join(outDir, "icons");
const SIZE = 1024;
const PAD = 0.16;

mkdirSync(outDir, { recursive: true });

const logoSvg = readFileSync(logoPath, "utf8");
const logoRender = new Resvg(logoSvg, {
  fitTo: { mode: "width", value: Math.round(SIZE * (1 - PAD * 2)) },
  background: "rgba(0,0,0,0)",
}).render();
const logoPng = logoRender.asPng();
const logoW = logoRender.width;
const logoH = logoRender.height;

const logoB64 = Buffer.from(logoPng).toString("base64");
const ox = Math.round((SIZE - logoW) / 2);
const oy = Math.round((SIZE - logoH) / 2 - SIZE * 0.02);

const squareSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="${SIZE * 0.22}" fill="#000000"/>
  <image x="${ox}" y="${oy}" width="${logoW}" height="${logoH}"
    href="data:image/png;base64,${logoB64}"
    xlink:href="data:image/png;base64,${logoB64}"/>
</svg>`;

const squarePng = new Resvg(squareSvg, {
  fitTo: { mode: "width", value: SIZE },
}).render().asPng();

writeFileSync(squarePngPath, squarePng);
console.log(`==> Wrote ${squarePngPath} (${SIZE}x${SIZE})`);

const tmpDir = mkdtempSync(join(tmpdir(), "acorn-icon-"));
const tmpPng = join(tmpDir, "app-icon.png");
const tmpPy = join(tmpDir, "reencode.py");
writeFileSync(
  tmpPy,
  [
    "from PIL import Image",
    `src = ${JSON.stringify(squarePngPath)}`,
    `dst = ${JSON.stringify(tmpPng)}`,
    'Image.open(src).convert("RGBA").save(dst)',
    "print(dst)",
  ].join("\n"),
);

const pillow = spawnSync("python3", [tmpPy], { encoding: "utf8" });
if (pillow.status !== 0) {
  console.warn("Pillow re-encode skipped; copying PNG to /tmp");
  copyFileSync(squarePngPath, tmpPng);
}

mkdirSync(iconsOut, { recursive: true });
// Avoid shell:true — project path may contain apostrophes (breaks /bin/sh).
const icon = spawnSync(
  "npx",
  ["tauri", "icon", tmpPng, "-o", iconsOut],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  },
);
if (icon.status !== 0) {
  process.exit(icon.status ?? 1);
}

console.log(`==> Icons generated in ${iconsOut}`);

/** Sync desktop app-icon.png into Android mipmaps (same Acorn mark as desktop). */
function syncAndroidLauncherIcons() {
  const androidRes = join(
    outDir,
    "gen/android/app/src/main/res",
  );
  if (!existsSync(androidRes)) {
    console.warn(`==> Android res yok, mipmap sync atlandı: ${androidRes}`);
    return;
  }

  const densities = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
  };

  const syncPy = join(tmpDir, "sync-android-icons.py");
  writeFileSync(
    syncPy,
    [
      "from PIL import Image",
      "from pathlib import Path",
      `src = Path(${JSON.stringify(squarePngPath)})`,
      `res = Path(${JSON.stringify(androidRes)})`,
      `densities = ${JSON.stringify(densities)}`,
      "img = Image.open(src).convert('RGBA')",
      "names = ('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png')",
      "for folder, size in densities.items():",
      "    out_dir = res / folder",
      "    out_dir.mkdir(parents=True, exist_ok=True)",
      "    resized = img.resize((size, size), Image.Resampling.LANCZOS)",
      "    for name in names:",
      "        resized.save(out_dir / name)",
      "        print(out_dir / name)",
    ].join("\n"),
  );

  const sync = spawnSync("python3", [syncPy], { encoding: "utf8" });
  if (sync.status !== 0) {
    console.warn("Android mipmap sync failed (Pillow gerekli):", sync.stderr || sync.stdout);
    return;
  }

  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#000000"/>
</shape>
`;
  mkdirSync(join(androidRes, "drawable"), { recursive: true });
  writeFileSync(join(androidRes, "drawable/ic_launcher_background.xml"), bgXml);

  const statIconXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M12,2C8.13,2 5,5.13 5,9c0,5.25 7,13 7,13s7,-7.75 7,-13c0,-3.87 -3.13,-7 -7,-7zM12,11.5c-1.38,0 -2.5,-1.12 -2.5,-2.5s1.12,-2.5 2.5,-2.5 2.5,1.12 2.5,2.5 -1.12,2.5 -2.5,2.5z" />
</vector>
`;
  writeFileSync(join(androidRes, "drawable/ic_stat_acorn.xml"), statIconXml);

  // Adaptive icons reference @color/ic_launcher_background (not the drawable).
  mkdirSync(join(androidRes, "values"), { recursive: true });
  writeFileSync(
    join(androidRes, "values/ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#000000</color>
</resources>
`,
  );

  // Replace default robot vector with a transparent placeholder (mipmap PNGs carry the mark).
  const fgXml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#000000"
        android:pathData="M0,0h108v108h-108z"/>
</vector>
`;
  mkdirSync(join(androidRes, "drawable-v24"), { recursive: true });
  writeFileSync(join(androidRes, "drawable-v24/ic_launcher_foreground.xml"), fgXml);

  console.log("==> Android launcher icons synced from app-icon.png");
}

syncAndroidLauncherIcons();

console.log("    Rebuild packages: npm run package:deb | npm run package:apk");
