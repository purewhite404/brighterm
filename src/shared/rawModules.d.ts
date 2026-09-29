// Ambient typing for Vite's `?raw` import suffix, used by both the main
// process (system prompt, AI kit) and the renderer (prompt builder) to inline
// packages/sdk/AGENTS.md and host-api.d.ts at build time instead of reading
// them from disk.
declare module '*.md?raw' {
  const content: string
  export default content
}
declare module '*.d.ts?raw' {
  const content: string
  export default content
}
