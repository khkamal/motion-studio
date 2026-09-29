/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_MODEL?: string;
  readonly VITE_ANALYTICS_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
