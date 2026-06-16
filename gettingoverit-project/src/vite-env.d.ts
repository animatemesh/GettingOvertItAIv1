/// <reference types="vite/client" />

// Allow importing .glb models as hashed asset URLs.
declare module '*.glb' {
  const src: string;
  export default src;
}
