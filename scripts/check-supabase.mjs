// Static checks for the Supabase folder, run in CI and locally (`npm run check:supabase`).
//  - every edge function must parse (catches duplicate declarations that cause BOOT_ERROR at deploy time)
//  - migration files must have unique, ordered timestamps
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { transform } from 'esbuild'

const root = new URL('../supabase/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const failures = []

// 1) Edge functions
const fnDir = join(root, 'functions')
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name)) {
    const entry = join(fnDir, name, 'index.ts')
    if (!existsSync(entry)) {
      // Empty leftover folders are ignored; a folder with files but no entrypoint is a real problem.
      if (readdirSync(join(fnDir, name)).length > 0) failures.push(`functions/${name}: missing index.ts`)
      continue
    }
    try {
      await transform(readFileSync(entry, 'utf8'), { loader: 'ts', sourcefile: `functions/${name}/index.ts` })
    } catch (error) {
      failures.push(`functions/${name}/index.ts does not parse:\n${(error.errors || [error]).map((e) => `  ${e.text || e.message}${e.location ? ` (line ${e.location.line})` : ''}`).join('\n')}`)
    }
  }
}

// 2) Migrations
const migDir = join(root, 'migrations')
if (existsSync(migDir)) {
  const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  const seen = new Set()
  for (const file of files) {
    if (/^\d{4}_.+\.sql$/.test(file)) continue // legacy sequential names (e.g. 0001_init.sql) predate timestamped migrations
    const match = file.match(/^(\d{14})_.+\.sql$/)
    if (!match) {
      failures.push(`migrations/${file}: name must be <14-digit timestamp>_<name>.sql`)
      continue
    }
    if (seen.has(match[1])) failures.push(`migrations/${file}: duplicate timestamp ${match[1]}`)
    seen.add(match[1])
    if (readFileSync(join(migDir, file), 'utf8').trim().length === 0) failures.push(`migrations/${file}: empty file`)
  }
}

if (failures.length > 0) {
  console.error(`Supabase checks failed (${failures.length}):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('Supabase checks passed: all edge functions parse and migrations are well-formed.')
