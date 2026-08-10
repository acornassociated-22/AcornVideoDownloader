/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORCE_MOBILE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
