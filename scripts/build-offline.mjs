import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const releaseDir = path.join(root, 'release')
const outFile = path.join(releaseDir, 'sub2api-txt-to-json-offline.html')
const sumsFile = path.join(releaseDir, 'SHA256SUMS.txt')

let html = await readFile(path.join(distDir, 'index.html'), 'utf8')
const assetsDir = path.join(distDir, 'assets')
const assets = await readdir(assetsDir)

html = html.replace(
  /<div id="app">[\s\S]*?<\/div>\s*<script type="module"/,
  '<div id="app"></div>\n    <script type="module"',
)

for (const asset of assets) {
  if (asset.endsWith('.css')) {
    const css = await readFile(path.join(assetsDir, asset), 'utf8')
    html = html.replace(
      new RegExp(`<link rel="stylesheet" crossorigin href="/assets/${escapeRegExp(asset)}">`),
      `<style>\n${css}\n</style>`,
    )
  }

  if (asset.endsWith('.js')) {
    const js = await readFile(path.join(assetsDir, asset), 'utf8')
    html = html.replace(
      new RegExp(`<script type="module" crossorigin src="/assets/${escapeRegExp(asset)}"></script>`),
      `<script type="module">\n${js}\n</script>`,
    )
  }
}

const unresolvedAssets = [
  /<script\b[^>]*\bsrc=/i,
  /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=)/i,
  /\b(?:src|href)=["']\/(?:assets|src)\//i,
]

for (const pattern of unresolvedAssets) {
  if (pattern.test(html)) {
    throw new Error(`Offline HTML still contains unresolved asset reference: ${pattern}`)
  }
}

await mkdir(releaseDir, { recursive: true })
await writeFile(outFile, html, 'utf8')

const digest = createHash('sha256').update(html, 'utf8').digest('hex')
await writeFile(sumsFile, `${digest}  sub2api-txt-to-json-offline.html\n`, 'utf8')

console.log(`Wrote ${path.relative(root, outFile)}`)
console.log(`SHA256 ${digest}`)

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
