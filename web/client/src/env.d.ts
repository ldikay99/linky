/// <reference types="vite/client" />

declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  const factory: () => unknown;
  export default factory;
}
