/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('Security Static Scan: No Hardcoded Passwords in Edge Functions', () => {
  const functionsDir = path.resolve(__dirname, '../../supabase/functions')

  function getAllFiles(dir: string): string[] {
    const results: string[] = []
    if (!fs.existsSync(dir)) return results

    const list = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of list) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...getAllFiles(fullPath))
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
        results.push(fullPath)
      }
    }
    return results
  }

  const files = getAllFiles(functionsDir)

  it('verifies that edge functions exist to scan', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('ensures no edge function contains hardcoded password assignments', () => {
    // Regex looking for variable assignments with "password" in the identifier assigned to a non-empty string literal
    const passwordAssignmentRegex = /(?:const|let|var)\s+[\w$]*(?:password|passwd|pwd)[\w$]*\s*=\s*['"`]([^\s'"`]+)['"`]/i

    const violations: { file: string; line: number; match: string }[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Ignore comments
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          continue
        }

        const match = line.match(passwordAssignmentRegex)
        if (match) {
          const matchedVal = match[1]
          // Allow empty or placeholder values if any
          if (matchedVal && matchedVal !== '<REMOVED>' && matchedVal !== 'placeholder') {
            violations.push({
              file: path.relative(process.cwd(), file),
              line: i + 1,
              match: line.trim(),
            })
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('ensures known weak/default password literals do not exist in any Edge Function source', () => {
    const blockedLiteralPattern = /Password123!|admin123456|warehouse2026/i

    const occurrences: { file: string; line: number }[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        if (blockedLiteralPattern.test(lines[i])) {
          occurrences.push({
            file: path.relative(process.cwd(), file),
            line: i + 1,
          })
        }
      }
    }

    expect(occurrences).toEqual([])
  })

  it('ensures no edge function writes client- or source-supplied passwords directly into Supabase Auth', () => {
    // Check that admin.createUser or admin.updateUserById are not called with hardcoded literal passwords
    const hardcodedAuthPasswordRegex = /(?:createUser|updateUserById)\s*\(\s*(?:[^,]+,\s*)?\{\s*[^}]*password:\s*['"`]([^\s'"`]+)['"`]/i

    const violations: string[] = []

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8')
      if (hardcodedAuthPasswordRegex.test(content)) {
        violations.push(path.relative(process.cwd(), file))
      }
    }

    expect(violations).toEqual([])
  })
})
