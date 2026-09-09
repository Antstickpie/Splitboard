# Mandatory Verification Rule: Ensure `npm start` Always Works

- **Primary Verification Command**: Always run `npm run verify` after ANY code or template modification before committing or declaring done.
- `npm run verify` executes:
  1. `npm run typecheck` (`tsc -p tsconfig.app.json --noEmit`) to verify all TypeScript types across the project.
  2. `npx ng build --configuration development` to perform full Angular AOT template compilation (catches HTML tag mismatches like NG5002, missing component imports, invalid bindings, and broken template syntax).
- **Never Declare Done or Commit Without Verification**: Every single commit or completion declaration MUST be preceded by a successful `npm run verify` run (exit code 0).
- **Dev-Server Compatibility**: `npm start` uses the development configuration (`splitboard:build:development`). Ensuring `npm run verify` passes guarantees that `npm start` will always compile and run cleanly without breaking watch mode.
- Keep agent actions fast and direct. Avoid running background dev-servers (`ng serve`), verbose python scrapers, or excessive loops.
