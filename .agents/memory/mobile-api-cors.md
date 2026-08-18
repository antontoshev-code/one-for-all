---
name: Mobile app ↔ API cross-origin
description: Expo companion app calls the API server cross-origin; CORS and absolute URLs are load-bearing.
---

The Expo mobile artifact runs on a separate `*.expo.*.replit.dev` origin and calls the shared API with absolute URLs built from `EXPO_PUBLIC_DOMAIN`. Non-spec endpoints (suggest-category, ai/status, data export/clear) are called via plain fetch to those absolute URLs.

**Why:** Expo bypasses the workspace path proxy, so root-relative `/api/...` URLs and same-origin assumptions break; browser preview also needs `Access-Control-Allow-Origin` from the API server (`cors()` middleware, currently `*`).

**How to apply:** Never remove/narrow the api-server CORS middleware without including the expo dev/prod origins; keep mobile API calls absolute. If mobile preview shows CORS errors, first check the api-server workflow is actually running — a crashed server surfaces as a CORS error in the browser.
