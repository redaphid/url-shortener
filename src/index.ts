import { AutoRouter, IRequest } from "itty-router"

const getLongUrl = async (request: IRequest, env: Env, ctx: ExecutionContext) => {
	const { shortUrl } = request.params
	const record = await env.short_urls.get(shortUrl)
	if (!record) return new Response("Not found", { status: 404 })
	// if it doesn't have a protocol, add https://
	const url = URL.canParse(record) ? record : `https://${record}`
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
	.get("/:shortUrl", getLongUrl)
	.post("/:shortUrl", createShortUrlUnlessItExists)
	.put("/:shortUrl", updateShortUrl)
	.delete("/:shortUrl", deleteShortUrl)
	.get("*", listShortUrls)

export default router
