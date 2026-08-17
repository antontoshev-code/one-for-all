---
name: Orval zod.int() patch for Zod v3
description: Orval v8 generates zod.int() which only exists in Zod v4; the workspace uses Zod v3 so the build fails. Fix is a sed post-process in the codegen script.
---

## The rule
When the workspace has `zod: ^3.x` in `pnpm-workspace.yaml` catalog, Orval v8 will still generate `zod.int()` for `type: integer` fields in the OpenAPI spec. This causes both `tsc --build` failures and runtime `TypeError: (void 0) is not a function`.

**Why:** Orval v8.23+ targets Zod v4 API by default but the monorepo template pins Zod v3.

**How to apply:** After running codegen, add a sed post-process step in `lib/api-spec/package.json`:

```json
"codegen": "orval --config ./orval.config.ts && sed -i 's/zod\\.int()/zod.number().int()/g' ../../lib/api-zod/src/generated/api.ts && pnpm -w run typecheck:libs"
```

Also run the sed fix manually on the already-generated file before the next build:
```bash
sed -i 's/zod\.int()/zod.number().int()/g' lib/api-zod/src/generated/api.ts
```

## Also: Google Fonts @import position in Tailwind CSS
Putting `@import url('https://fonts.googleapis.com/...')` after `@import 'tailwindcss'` causes a PostCSS error at build time because Tailwind expands inline and the Google Fonts import ends up after CSS rules in the compiled bundle.

**Fix:** Always place the Google Fonts `@import url(...)` as the very first line of `index.css`, before `@import 'tailwindcss'`.
