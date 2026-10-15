// Builds the app for the private claude.ai Artifact preview.
//
// The Artifact host wraps the published page in its own <html>/<head>/<body>
// skeleton and serves supporting files next to it, so this builds with
// relative asset URLs and rewrites index.html down to its head tags and body.
//
// Output: dist-preview/fieldverse.html (CSS inlined) plus dist-preview/assets/*.js.
import { execSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = 'dist-preview'
rmSync(outDir, { recursive: true, force: true })
execSync(`npx vite build --base ./ --outDir ${outDir}`, { stdio: 'inherit' })

const html = readFileSync(join(outDir, 'index.html'), 'utf8')
const pick = (re, what) => {
  const m = html.match(re)
  if (!m) throw new Error(`build-preview: no ${what} in ${outDir}/index.html`)
  return m[0]
}
const title = pick(/<title>[^<]*<\/title>/, 'title')
// Inline the (small) stylesheet so the page styles itself without another request.
const styles = (html.match(/<link rel="stylesheet"[^>]*>/g) ?? []).map((tag) => {
  const file = tag.match(/href="\.\/([^"]+)"/)?.[1]
  if (!file) throw new Error(`build-preview: unexpected stylesheet tag ${tag}`)
  const css = readFileSync(join(outDir, file), 'utf8')
  rmSync(join(outDir, file))
  return `<style>\n${css}\n</style>`
})
const scripts = html.match(/<script type="module"[^>]*><\/script>/g) ?? []
if (scripts.length === 0) throw new Error('build-preview: no module script found')
const body = pick(/<body>[\s\S]*<\/body>/, 'body')
  .replace(/^<body>/, '')
  .replace(/<\/body>$/, '')
  .trim()

const page = [title, ...styles, ...scripts, body].join('\n') + '\n'
writeFileSync(join(outDir, 'fieldverse.html'), page)
rmSync(join(outDir, 'index.html'))
console.log(`build-preview: wrote ${outDir}/fieldverse.html`)
