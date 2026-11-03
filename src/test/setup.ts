import '@testing-library/jest-dom/vitest'

// jsdom has no Web Locks API. Repository tests use the in-process queue; browser code
// requires a real cross-tab lock and rejects mutations if the API is unavailable.
if (typeof window !== 'undefined') {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, callback: () => unknown) => callback() },
  })
}
