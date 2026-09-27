// Ambient typing for Vite's `?raw` import suffix, used by both the main
// process (system prompt text) and the renderer (prompt builder) to inline
// packages/sdk/AGENTS.md at build time instead of reading it from disk.
declare module '*.md?raw' {
  const content: string
  export default content
}
