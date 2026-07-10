# Creative Coding

Static sketches. Shared fonts/icons live in `assets/`; each sketch lives under `projects/`.

```
assets/
projects/
  hofmann-rubberband/
index.html
```

## Local

Serve the **repo root** (so `assets/` resolves):

```bash
npx --yes serve -l 8780 .
```

Then open:

- http://localhost:8780/
- http://localhost:8780/projects/hofmann-rubberband/

## Deploy (Cloudflare Pages)

1. Push this repo to GitHub.
2. In [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Select the repo.
4. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/` (repo root)
5. Deploy. Share `https://<project>.pages.dev/projects/hofmann-rubberband/`.

No build step — Pages serves the static files as-is.
