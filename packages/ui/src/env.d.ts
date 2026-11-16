/**
 * Bundler-injected environment surface. Sites build this package with
 * Vite/VitePress, which replaces import.meta.env.BASE_URL with the site
 * base at build time; vitest provides '/' by default.
 */
interface ImportMeta {
  readonly env: {
    readonly BASE_URL: string
  }
}
