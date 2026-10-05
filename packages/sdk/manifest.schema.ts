import { z } from 'zod'

/**
 * The manifest every plugin (`.btplugin` zip, or a "btbundle" an AI wrote)
 * must include as `manifest.json`. Validated with zod so a malformed or
 * over-reaching manifest is rejected with a precise error before anything
 * from the plugin ever runs. Errors are in Japanese: the user reads them, and
 * the AI gets them back verbatim in the fix request.
 */

const domainPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i

const PERMISSION_TYPES = ['network', 'storage', 'folders', 'notifications', 'hqCards'] as const

export const PluginPermissionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('network'),
    domains: z
      .array(z.string().regex(domainPattern, 'ドメイン名だけを書いてください（例: "api.example.com"）'))
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
    id: z.string().regex(idPattern, '英小文字・数字・ハイフンだけにしてください（例: "photo-viewer"）'),
    name: z.string().min(1).max(60),
    version: z.string().regex(versionPattern, '"0.1.0" のような形にしてください'),
    icon: z.string().min(1).max(40),
    kind: z.enum(['web', 'app']),
    url: z.string().url().optional(),
    entry: z.string().min(1).max(200).optional(),
    permissions: z.array(PluginPermissionSchema).max(10).default([]),
    description: z.string().max(400).optional()
  })
  .superRefine((manifest, ctx) => {
    if (manifest.kind === 'web' && !manifest.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'kind が "web" のときは必須です', path: ['url'] })
    }
    // A web tile shows a web page; a file:// (or any other scheme) page has no place there.
    if (manifest.url !== undefined && !/^https?:\/\/[^/]/i.test(manifest.url)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'http:// か https:// で始まる URL にしてください', path: ['url'] })
    }
    if (manifest.kind === 'app' && !manifest.entry) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'kind が "app" のときは必須です（通常 "index.html"）', path: ['entry'] })
    }
    if (manifest.entry?.includes('..') || manifest.entry?.startsWith('/')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'プラグイン内の相対パスにしてください', path: ['entry'] })
    }
  })

export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type PluginPermission = z.infer<typeof PluginPermissionSchema>

/** One zod issue as a Japanese sentence, e.g. 「id」がありません. */
function describeIssue(issue: z.ZodIssue): string {
  const field = issue.path.length > 0 ? `「${issue.path.join('.')}」` : 'manifest.json 全体'
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return issue.received === 'undefined'
        ? `${field}がありません`
        : `${field}の値の種類が違います（${issue.expected} にしてください）`
    case z.ZodIssueCode.invalid_enum_value:
      return `${field}は ${issue.options.map((o) => JSON.stringify(o)).join(' か ')} にしてください`
    case z.ZodIssueCode.invalid_union_discriminator:
      return `${field}は ${PERMISSION_TYPES.map((t) => JSON.stringify(t)).join(' / ')} のどれかにしてください`
    case z.ZodIssueCode.too_small:
      return `${field}が空です`
    case z.ZodIssueCode.too_big:
      return `${field}が長すぎます（${issue.maximum} ${issue.type === 'array' ? '個' : '文字'}まで）`
    case z.ZodIssueCode.invalid_string:
      return issue.validation === 'url' ? `${field}は正しい URL にしてください` : `${field}: ${issue.message}`
    default:
      return `${field}: ${issue.message}`
  }
}

export function parseManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] } {
  const result = PluginManifestSchema.safeParse(raw)
  if (result.success) return { ok: true, manifest: result.data }
  return { ok: false, errors: result.error.issues.map(describeIssue) }
}
