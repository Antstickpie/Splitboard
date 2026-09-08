# TypeScript & Build Verification Rule

- For Angular and TypeScript projects with project references (e.g. tsconfig.json referencing tsconfig.app.json), plain `tsc --noEmit` checks 0 files.
- Run `npm run typecheck` (or `tsc -p tsconfig.app.json --noEmit`) after code changes to catch all TypeScript and Angular type errors.
- Keep agent actions fast and direct. Avoid running slow dev-servers (`ng serve`), verbose python scrapers, or excessive background loops.



