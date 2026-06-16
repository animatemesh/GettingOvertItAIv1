/// <reference types="vite/client" />

// Allow importing .glb models as hashed asset URLs.
declare module '*.glb' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://xxxx.supabase.co (optional; falls back to local scores). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public API key (safe to expose; guarded by Row-Level Security). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
