/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync('src/App.css', 'utf8')
const tokens = readFileSync('src/index.css', 'utf8')
const reportsSource = readFileSync('src/pages/ReportsPage.tsx', 'utf8')
function luminance(hex: string) {
  const channels = hex.match(/\w\w/g)!.map((v) => parseInt(v, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
it('keeps primary button foreground contrast above 4.5:1 in both themes', () => {
  const themes = [...tokens.matchAll(/(?:^:root|^:root\[data-theme='dark'\])\s*\{([^}]+)\}/gm)]
  expect(themes).toHaveLength(2)
  for (const block of themes) {
    const background = luminance(block[1].match(/--accent:\s*#([\da-f]+)/i)![1])
    const foreground = luminance(block[1].match(/--accent-foreground:\s*#([\da-f]+)/i)![1])
    expect((Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)).toBeGreaterThanOrEqual(4.5)
  }
  expect(css).toMatch(/\.primary-btn\s*\{[^}]*color: var\(--accent-foreground\)/)
})
it('disables animations when reduced motion is requested', () => {
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important/)
})
it('declares shrinkable mobile form, authentication, backup, and filter layouts', () => {
  expect(css).toMatch(/\.auth-panel\s*\{[^}]*min-width: 0;[^}]*grid-template-columns: minmax\(0, 1fr\)/)
  expect(css).toMatch(/\.auth-form input\s*\{[^}]*min-width: 0/)
  expect(css).toMatch(/\.purchase-form-grid \{ grid-template-columns: minmax\(0, 1fr\)/)
  expect(css).toMatch(/\.backup-cards-grid\s*\{[^}]*minmax\(min\(100%, 320px\), 1fr\)/)
  expect(css).toContain('.custody-filter-selects { flex-direction: column; align-items: stretch; width: 100%; }')
  expect(reportsSource).not.toMatch(/minmax\((260|320|420)px, 1fr\)/)
})
