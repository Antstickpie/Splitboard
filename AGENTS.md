# Mandatory Verification Rule: Ensure `npm start` Always Works

- **Primary Verification Command**: Always run `npm run verify` (`ng build --configuration development`) after ANY code or template modification before committing or declaring done.
- **Single Unified Check (No Duplicate Passes)**: `ng build --configuration development` natively runs Angular's application compiler against `tsconfig.app.json`. In a single pass, it verifies both TypeScript types AND full Angular AOT template syntax (catching HTML tag mismatches like NG5002, missing imports, and broken bindings). Do NOT run `tsc`/`npm run typecheck` separately before `npm run verify` as that duplicates type checking and wastes time.
- **macOS Sandbox Rule**: On macOS, esbuild worker threads encounter `Abort trap: 6` inside the sandbox. Always execute `npm run verify` with `BypassSandbox: true` to complete cleanly in one shot without aborting or retrying in a loop.
- **Streamlined Flow**:
  1. Make edits.
  2. Run `npm run verify` once (`BypassSandbox: true`).
  3. Commit directly with `BypassSandbox: true` (avoid running redundant chains of `git status`, `git diff`, `ls` beforehand).
- **Dev-Server Compatibility**: `npm start` uses `splitboard:build:development`. A passing `npm run verify` guarantees that `npm start` will run cleanly without breaking watch mode.
- Keep agent actions fast and direct: avoid background dev servers (`ng serve`), repetitive verification loops, or generating unprompted walkthrough artifacts.
