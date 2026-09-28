# 2cb.pw

URL shortener and file host on Cloudflare Workers.

- `GET /<code>` - public. Redirects a short link, or streams a hosted file (supports Range).
  Add `?dl` to force a download.
- `GET /<code>/<path>` - subpaths. For a link, the rest of the path is carried onto the target
  (`/docs/api` -> `<docs target>/api`). For a site (an uploaded zip), it names a file inside it.
  Keys set by hand with slashes in them (`app/list`) are matched longest-first.
- `GET /` - the UI. Drag-drop files, paste screenshots, shorten links, post text.
- `GET /up` - redirects to the UI. It exists as a path for Cloudflare Access to gate.

The UI is not a bundled static asset. It is stored as ordinary content under the reserved
key `_root` and served by the same code path as any uploaded file, so this Worker has no
asset binding and the root needs no special case. Codes must begin with an alphanumeric,
so no user-supplied code can collide with `_root`.

Because the UI is content, `npm run deploy` both deploys the Worker and republishes
`public/index.html`; a Worker deploy alone would leave the live page on an older build.
Publishing needs `UPLOAD_KEY` set to the Worker's `UPLOAD_TOKEN` secret.
- `POST /api/*` - write endpoints. **Never open**: every write requires either a verified
  Cloudflare Access JWT (`ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` vars) or the `UPLOAD_TOKEN`
  secret sent as `X-Upload-Token`. With neither configured, writes are refused.

Links live in KV (`short-urls`), files in R2 (`2cb-files`). Links created before file
hosting are stored as bare URL strings and still resolve.

## Upload from the shell

    curl -X POST -H "X-Upload-Token: $KEY" --data-binary @photo.jpg \
      "https://2cb.pw/api/upload?name=photo.jpg&type=image/jpeg"

## Publish a zip as a site

Upload a `.zip` and it is unpacked, not stored: every file in it is served under the code.

    curl -X POST -H "X-Upload-Token: $KEY" --data-binary @site.zip \
      "https://2cb.pw/api/upload?name=site.zip&type=application/zip&code=keeper"
    # -> https://2cb.pw/keeper/  (index.html), https://2cb.pw/keeper/css/app.css, ...

- `/<code>` redirects to `/<code>/` so relative links in the page work; directories serve
  their `index.html`, and a `404.html` at the top of the zip is used for missing paths.
- A single wrapper folder (what "Compress folder" produces) is peeled off, and `__MACOSX/`
  and `.DS_Store` are skipped.
- Add `extract=0` to keep the zip as a plain downloadable file instead.
- Stored and deflated entries are supported; ZIP64 and encrypted archives are refused with a
  422 and the code is left free. Deleting the code deletes every file of the site.
- Site pages run on the 2cb.pw origin, same as the UI, so only publish zips you trust.

Files over 64 MB use the multipart endpoints (`/api/multipart/create`, `/part`, `/complete`),
which the web UI drives automatically.

## Develop

    npm install
    npm test
    npm run dev
