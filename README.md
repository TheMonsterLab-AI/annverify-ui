# annverify-ui

Standalone fact-checking dashboard UI, deployed to `app.annverify.ai` via Cloudflare Pages.

No build step — plain HTML/CSS/JS, external CDN only (Google Fonts, Firebase compat SDK).

- `index.html` — page shell (sidebar, verify input, result panel)
- `app/config.js` — Firebase config + shared constants
- `app/auth.js` — Google sign-in via Firebase Auth (`annverify-prod`)
- `app/history.js` — client-side verification history (localStorage; no direct Firestore access)
- `app/render.js` — renders the verify result ("Full Dossier") from the API response
- `app/main.js` — wires the input and calls `POST https://api.annverify.ai/api/verify`

## Deploy

```
wrangler pages deploy . --project-name=annverify-ui
```
