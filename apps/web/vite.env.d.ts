/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_AI_PROVIDER: string;
  readonly VITE_AI_MODEL: string;
  readonly VITE_ENABLE_AI: string;
  readonly VITE_ENABLE_CLOUD_SYNC: string;
  readonly VITE_ANALYTICS_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
