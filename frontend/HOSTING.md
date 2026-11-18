# CLUEZY Frontend — Hosting & Deployment Guide

This folder contains the **fully static** frontend for CLUEZY, including HTML, CSS, JavaScript, images, and fonts.

## Deployment Options

### Vercel
1. Set the root directory or output directory to `frontend`.
2. Vercel automatically detects `vercel.json` for proper `.mjs` MIME types.
3. No build command required.

### Netlify / Cloudflare Pages
1. Build command: None (leave blank).
2. Publish directory: `frontend`.
3. Netlify and Cloudflare Pages automatically read `_headers` and `_redirects`.

### Local Testing

Serve the `frontend` folder using any HTTP server:

```bash
# Using Node / npx:
npx serve frontend -p 5173

# Or with Python:
python -m http.server 5173 --directory frontend
```

Then open `http://localhost:5173`.

## Pages & Routes

- `/` → `index.html` (Landing page)
- `/investigation/` → `investigation/index.html` (Active investigation chat)
- `/investigations/` → `investigations/index.html` (Past investigations list)
- `/knowledge-base/` → `knowledge-base/index.html` (Knowledge base & guides)
- `/solution/` → `solution/index.html` (Solution walkthrough)
- `/resolved/` → `resolved/index.html` (Resolution summary)
