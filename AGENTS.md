# TypeScript & Build Verification Rule

- For Angular and TypeScript projects with project references (e.g. tsconfig.json referencing tsconfig.app.json), plain `tsc --noEmit` checks 0 files.
- ALWAYS run `npm run typecheck` (or `tsc -p tsconfig.app.json --noEmit`), `npm run build`, and `npx ng serve --watch=false` (which validates the exact `npm start` dev compiler plugin rules and catches all `@HostListener` / Angular compiler errors) after making code changes before declaring done.


