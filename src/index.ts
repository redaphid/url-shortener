import { AutoRouter, IRequest } from "itty-router"
import { isAuthorized, unauthorized } from "./auth"
import { isValidSlug, nanoid } from "./slug"
import { page } from "./page"

const wantsJson = (request: Request): boolean => (request.headers.get("accept") ?? "").includes("application/json")

const shortUrlFor = (request: Request, slug: string): string => new URL(`/${slug}`, request.url).toString()

// Accepts `{"url": "..."}`, `{"longUrl": "..."}`, or a bare URL as the body,
// so `curl -d https://example.com` is enough.
const readLongUrl = async (request: Request): Promise<string | null> => {
	const body = (await request.text()).trim()
	if (!body) return null
	let candidate = body
	if (body.startsWith("{")) {
		try {
			const parsed = JSON.parse(body) as { url?: string; longUrl?: string }
			candidate = (parsed.url ?? parsed.longUrl ?? "").trim()
		} catch {
			return null
		}
	}
	if (!candidate) return null
	const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`
	if (!URL.canParse(normalized)) return null
	const url = new URL(normalized)
	if (url.protocol !== "http:" && url.protocol !== "https:") return null
	return url.toString()
}

const created = (request: Request, slug: string, url: string): Response => {
	const shortUrl = shortUrlFor(request, slug)
	if (wantsJson(request)) {
		return new Response(JSON.stringify({ slug, shortUrl, url }), {
			status: 201,
			headers: { "content-type": "application/json", location: shortUrl }
		})
	}
	return new Response(`${shortUrl}\n`, { status: 201, headers: { "content-type": "text/plain", location: shortUrl } })
}

const resolveUrl = async (path: string, env: Env): Promise<{ record: string; rest: string } | null> => {
	// Try exact match first, then progressively shorter prefixes
	const segments = path.split("/")
	for (let i = segments.length; i > 0; i--) {
		const prefix = segments.slice(0, i).join("/")
		const record = await env.short_urls.get(prefix)
		if (record) {
			const rest = segments.slice(i).join("/")
			return { record, rest }
		}
	}
	return null
}

const getLongUrl = async (request: IRequest, env: Env) => {
	const path = new URL(request.url).pathname.slice(1) // strip leading /
	const match = await resolveUrl(decodeURIComponent(path), env)
	if (!match) return new Response("Not found\n", { status: 404 })
	const base = URL.canParse(match.record) ? match.record : `https://${match.record}`
	const url = match.rest ? `${base.replace(/\/$/, "")}/${match.rest}` : base
	return Response.redirect(url, 301)
}

// POST /        -> shorten with a generated slug
// POST /<slug>  -> shorten at <slug>, refusing to clobber an existing link
const createShortUrl = async (request: IRequest, env: Env): Promise<Response> => {
	if (!isAuthorized(request, env)) return unauthorized()
	const longUrl = await readLongUrl(request)
	if (!longUrl) return new Response("Expected a URL in the body\n", { status: 400 })

	const requested = request.params.slug
	if (requested) {
		if (!isValidSlug(requested)) return new Response("Invalid slug\n", { status: 400 })
		if (await env.short_urls.get(requested)) return new Response("Short URL already exists\n", { status: 409 })
		await env.short_urls.put(requested, longUrl)
		return created(request, requested, longUrl)
	}

	// Generated slugs are long enough that a collision is a curiosity, not a plan
	for (let attempt = 0; attempt < 5; attempt++) {
		const slug = nanoid()
		if (await env.short_urls.get(slug)) continue
		await env.short_urls.put(slug, longUrl)
		return created(request, slug, longUrl)
	}
	return new Response("Could not allocate a slug\n", { status: 503 })
}

// PUT /<slug> -> create or replace
const updateShortUrl = async (request: IRequest, env: Env): Promise<Response> => {
	if (!isAuthorized(request, env)) return unauthorized()
	const { slug } = request.params
	if (!isValidSlug(slug)) return new Response("Invalid slug\n", { status: 400 })
	const longUrl = await readLongUrl(request)
	if (!longUrl) return new Response("Expected a URL in the body\n", { status: 400 })
	await env.short_urls.put(slug, longUrl)
	return created(request, slug, longUrl)
}

const deleteShortUrl = async (request: IRequest, env: Env): Promise<Response> => {
	if (!isAuthorized(request, env)) return unauthorized()
	const { slug } = request.params
	await env.short_urls.delete(slug)
	return new Response("Deleted\n", { status: 200 })
}

const listShortUrls = async (request: IRequest, env: Env): Promise<Response> => {
	const { keys } = await env.short_urls.list()
	const links = await Promise.all(
		keys.map(async ({ name }) => ({ slug: name, url: (await env.short_urls.get(name)) ?? "" }))
	)
	return new Response(JSON.stringify({ links }), { status: 200, headers: { "content-type": "application/json" } })
}

// The root is the web UI for humans and the link list for tokens asking for JSON.
const home = async (request: IRequest, env: Env): Promise<Response> => {
	if (!wantsJson(request)) return new Response(page(), { headers: { "content-type": "text/html; charset=utf-8" } })
	if (!isAuthorized(request, env)) return unauthorized()
	return listShortUrls(request, env)
}

const router = AutoRouter()
	.get("/", home)
	.post("/", createShortUrl)
	.post("/:slug+", createShortUrl)
	.put("/:slug+", updateShortUrl)
	.delete("/:slug+", deleteShortUrl)
	.get("/:slug+", getLongUrl)

export default router
