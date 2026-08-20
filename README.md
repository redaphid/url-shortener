# 2cb.pw

A personal URL shortener on Cloudflare Workers + KV.

## Three ways to use it

**The web page** — open <https://2cb.pw>, paste a URL, hit Shorten. The link is
copied to your clipboard. Paste your token once and the browser remembers it.

**The CLI** — put `short` on your `$PATH` and your token in
`~/.config/2cb.pw/token`:

```fish
short https://example.com/a/very/long/path        # → https://2cb.pw/V1StGXR8
short https://example.com/a/very/long/path blog   # → https://2cb.pw/blog
short blog https://example.com                    # order doesn't matter
short ls                                          # list every link
short get blog                                    # where does /blog point?
short rm blog                                     # delete it
```

It talks to the worker over HTTPS, so it works from any directory on any
machine — no repo checkout, no `wrangler`, no Cloudflare login.

**curl** — the body is just the URL:

```sh
curl -H "Authorization: Bearer $TOKEN" -d https://example.com https://2cb.pw/
curl -H "Authorization: Bearer $TOKEN" -d https://example.com https://2cb.pw/blog
```

## API

| Method   | Path        | Auth | Does                                                |
| -------- | ----------- | ---- | --------------------------------------------------- |
| `GET`    | `/<slug>`   | —    | 301 to the long URL; extra path segments pass through |
| `GET`    | `/`         | —    | The web page (JSON link list with `Accept: application/json` + a token) |
| `POST`   | `/`         | ✓    | Shorten, generating an 8-character nanoid slug       |
| `POST`   | `/<slug>`   | ✓    | Shorten at `<slug>`; 409 if it already exists        |
| `PUT`    | `/<slug>`   | ✓    | Shorten at `<slug>`, replacing whatever was there    |
| `DELETE` | `/<slug>`   | ✓    | Remove a link                                        |

Request bodies accept a bare URL (`https://example.com`), a bare host
(`example.com`, which gets `https://`), or JSON (`{"url": "..."}`).
Responses are plain text unless you send `Accept: application/json`.

Path passthrough means one link covers a whole site: with `/docs` →
`https://example.com/docs`, the link `2cb.pw/docs/guide/intro` lands on
`https://example.com/docs/guide/intro`.

## Setup

```sh
npm install
openssl rand -base64 32 | tee ~/.config/2cb.pw/token   # your token
npx wrangler secret put SHORTENER_TOKEN                 # paste the same value
npm run deploy
```

For local dev, copy `.dev.vars.example` to `.dev.vars`, put a token in it, and
run `npm run dev`. Point the CLI at it with `set -x SHORT_BASE http://localhost:8787`.

## Tests

```sh
npm test
```

Auth is a single shared bearer token — enough for one person's links. The
route shape is unchanged if it later moves behind Google OAuth or Cloudflare
Access; only `isAuthorized` in `src/auth.ts` has to change.
