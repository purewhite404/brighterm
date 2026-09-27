import { z } from 'zod'

/**
 * The manifest every plugin (`.btplugin` zip, or a "btbundle" an AI wrote)
 * must include as `manifest.json`. Validated with zod so a malformed or
 * over-reaching manifest is rejected with a precise error before anything
 * from the plugin ever runs.
 */

const domainPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i

export const PluginPermissionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('network'),
    domains: z
      .array(z.string().regex(domainPattern, 'expected a bare hostname, e.g. "api.example.com"'))
      .min(1)
      .max(20)
  }),
  z.object({ type: z.literal('storage') }),
  z.object({ type: z.literal('folders') }),
  z.object({ type: z.literal('notifications') }),
  z.object({ type: z.literal('hqCards') })
])

// id: lowercase kebab-case, used as a directory name on disk — must stay filesystem-safe.
const idPattern = /^[a-z][a-z0-9-]{1,40}$/
// semver-ish; deliberately permissive (no pre-release/build metadata parsing needed here).
const versionPattern = /^\d+\.\d+\.\d+$/

export const PluginManifestSchema = z
  .object({
    id: z.string().regex(idPattern, 'id must be lowercase kebab-case, e.g. "photo-viewer"'),
    name: z.string().min(1).max(60),
    version: z.string().regex(versionPattern, 'version must be semver, e.g. "1.0.0"'),
    icon: z.string().min(1).max(40),
    kind: z.enum(['web', 'app']),
    url: z.string().url().optional(),
    entry: z.string().min(1).max(200).optional(),
    permissions: z.array(PluginPermissionSchema).max(10).default([]),
    description: z.string().max(400).optional()
  })
  .superRefine((manifest, ctx) => {
    if (manifest.kind === 'web' && !manifest.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'kind "web" requires a "url"', path: ['url'] })
    }
    if (manifest.kind === 'app' && !manifest.entry) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'kind "app" requires an "entry" file', path: ['entry'] })
    }
    if (manifest.entry?.includes('..') || manifest.entry?.startsWith('/')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'entry must be a relative path within the plugin', path: ['entry'] })
    }
  })

export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type PluginPermission = z.infer<typeof PluginPermissionSchema>

export function parseManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] } {
  const result = PluginManifestSchema.safeParse(raw)
  if (result.success) return { ok: true, manifest: result.data }
  return { ok: false, errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
}
