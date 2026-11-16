# Changelog

Versioning follows [SemVer](https://semver.org). The version lives in `package.json` and is shown at the bottom of the sidebar.

## 1.0.0

### Added
- Glass (frosted) design for the application frame (sidebar, top bar, bottom dock, KPI cards, modals) with a solid fallback,
  `prefers-reduced-transparency` support and a solid print style.
- Night-blue dark theme.
- Excel import inside the purchases page (system admin); import templates now download empty (headers only).
- Logout button inside the mobile drawer.
- In-app toasts and confirmation dialogs (`notify`, `confirmDialog`) replacing the browser `alert`/`confirm`.
- Client error reporting into the audit log (`client_error`, severity `warning`).
- Session-expiry handling: a 401 from the data API triggers one token refresh, otherwise the user is asked to sign in again; the sync banner has a retry button.
- `npm run check:supabase` (edge functions must parse; migrations well-formed) in CI, plus a manual deploy workflow for Supabase.

### Changed
- Sign-in and password recovery use the registered e-mail only (UI and `login-bridge` / `admin-users`).
- Security report is sent every 6 hours and monitor messages older than 24 hours are deleted from Telegram.
- Dashboard quick actions and the greeting strip were simplified (greeting only on the home page).
- Mobile bottom dock sits below modals so form actions are never covered.

### Fixed
- Duplicate declarations in `admin-users` that stopped the function from booting.
- Bottom dock "Warehouses" link pointed to a redirecting route.
- Dark/light contrast issues and users page layout overflow.
- Duplicate React keys in the custody print/settlement modals.
