// Vite's `?raw` import hands a file back as a string; tests use it for saved
// pages. A narrow declaration is preferred over the whole Vite client lib.
declare module '*?raw' {
  const content: string;
  export default content;
}
