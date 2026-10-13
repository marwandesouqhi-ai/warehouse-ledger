# Data Model Overview

This project is structured around a warehouse ledger domain that mirrors the required business logic:

- `organizations`: organizational container for the stock ledger.
- `items`: normalized item catalog used in item-level stock cards.
- `parties`: suppliers and recipients with normalized names and merge support.
- `movements`: single ledger transactions with received and issued values, quantity in/out, and related metadata.
- `import_batches`: versioned batch import metadata and undo support.
- `audit_log`: append-only event stream.

The shared TypeScript library in `src/lib` intentionally mirrors the SQL view design described in the specification so the same rules can be reused in the client shell and eventually in the database view logic.
