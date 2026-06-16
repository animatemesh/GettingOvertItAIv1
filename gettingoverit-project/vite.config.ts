import { defineConfig } from 'vite';

// Treat .glb (and .gltf) files as importable assets so `import url from './x.glb'`
// resolves to a hashed URL the GLTFLoader can fetch.
export default defineConfig({
  assetsInclude: ['**/*.glb', '**/*.gltf'],
});
