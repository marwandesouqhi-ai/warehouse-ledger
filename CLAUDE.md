## Token Optimization & Execution Rules (STRICT)
- **Zero Fluff & Concise Output:** Do NOT output conversational filler, greetings, apologies, or step-by-step summaries of what you are about to do or just did. Output only critical blockers or a 1-2 line final status.
- **Targeted File Reading:** NEVER read entire large files unless strictly necessary. Always use `grep`/`rg` or `glob` first to locate exact line numbers, then read only the relevant slice (`offset` and `limit`).
- **Minimal Context & Diffs:** Do NOT reprint unchanged code. Use minimal, surgical edits. Never explain standard code changes unless asked.
- **Command Output Filtering:** When running terminal/build/test commands, pipe or filter output to show only errors/failures (e.g., `2>&1 | tail -n 30` or quiet flags `--silent` / `-q`) to avoid flooding context with logs.
- **Ignore Bloat:** Never read, list, or search inside `node_modules/`, `.next/`, `dist/`, `build/`, `.git/`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, or generated assets/SQL dumps.
- **Batch Tool Calls:** Execute independent search or read operations in parallel in a single turn rather than sequential back-and-forth turns.
- **Stop on First Pass:** Once tests/typecheck pass for the requested task, stop immediately. Do not refactor unrelated code or suggest unrequested improvements.
