import { AutoRouter, IRequest } from "itty-router"

const resolveUrl = async (path: string, env: Env): Promise<{ record: string, rest: string } | null> => {
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

const getLongUrl = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	const path = new URL(request.url).pathname.slice(1) // strip leading /
	const match = await resolveUrl(path, env)
	if (!match) return new Response("Not found", { status: 404 })
	const base = URL.canParse(match.record) ? match.record : `https://${match.record}`
	const url = match.rest ? `${base.replace(/\/$/, "")}/${match.rest}` : base
	return Response.redirect(url, 301)
}

const createShortUrlUnlessItExists = async (request: IRequest, env: Env, ctx: ExecutionContext): Promise<Response> => {
	throw new Error("Waiting for idp")
	const { shortUrl } = request.params
	const record = await env.short_urls.get(shortUrl)
	if (record) return new Response("Short URL already exists", { status: 400 })
	const body = await request.json()
	const { longUrl } = body as { longUrl: string }
	await env.short_urls.put(shortUrl, longUrl)
	return new Response("Created", { status: 201 })
}

const updateShortUrl = async (request: IRequest, env: Env, ctx: ExecutionContext): Promise<Response> => {
	throw new Error("Waiting for idp")
	const { shortUrl } = request.params
	const body = await request.json()
	const { longUrl } = body as { longUrl: string }
	await env.short_urls.put(shortUrl, longUrl)
	return new Response("Updated", { status: 200 })
}

const deleteShortUrl = async (request: IRequest, env: Env, ctx: ExecutionContext): Promise<Response> => {
	throw new Error("Waiting for idp")
	const { shortUrl } = request.params
	await env.short_urls.delete(shortUrl)
	return new Response("Deleted", { status: 200 })
}

const listShortUrls = async (request: IRequest, env: Env, ctx: ExecutionContext): Promise<Response> => {
	throw new Error("Waiting for idp")
	// if they ask for html, return a list of short urls
	const records = await env.short_urls.list()
	const shortToLong = new Map<string, string>()
	for await (const record of records.keys) {
		shortToLong.set(record.name, (await env.short_urls.get(record.name)) ?? "")
	}
	if (request.headers.get("accept") === "application/json") {
		return new Response(JSON.stringify(shortToLong), { status: 200 })
	}
	return new Response(
		Array.from(shortToLong.entries())
			.map(([shortUrl, longUrl]) => `<a href="${longUrl}">${shortUrl}</a>`)
			.join("\n"),
		{
			status: 200
		}
	)
}

const router = AutoRouter()
	.post("/:shortUrl", createShortUrlUnlessItExists)
	.put("/:shortUrl", updateShortUrl)
	.delete("/:shortUrl", deleteShortUrl)
	.get("/:shortUrl+", getLongUrl)
	.get("*", listShortUrls)

export default router
