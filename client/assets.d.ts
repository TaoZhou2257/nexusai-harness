/** Bundled images are inlined as data URLs by `scripts/build.mjs` (loader: dataurl). */
declare module '*.png' {
  const dataUrl: string
  export default dataUrl
}
