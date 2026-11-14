Execute the following task in ultra-low token mode:
- Locate target lines using grep/search first; read only minimal line ranges, never full files.
- Ignore lockfiles, build folders, and node_modules.
- Apply surgical edits only; do not touch unrelated code.
- Suppress verbose CLI/test logs (show errors only).
- Zero explanations, zero summaries, zero filler text. Report only the final result in max 2 lines.

Task: $ARGUMENTS
