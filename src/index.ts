/**
 * 2cb.pw - URL Shortener
 *  - if someone makes  GET request to /{short_url}
 *  - check if it exists in KV
 *  - if it does, redirect to the original URL permanently
 *  - if it doesn't, return a 404
 **/
const getLongUrl = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const shortUrl = request.url.split("/").pop()
  if (!shortUrl) return new Response("Not found", { status: 404 })
  const record = await env.short_urls.get(shortUrl)
  if (!record) return new Response("Not found", { status: 404 })
  // if it doesn't have a protocol, add https://
  const url = URL.canParse(record) ? record : `https://${record}`
  return Response.redirect(url, 301)
}

const createShortUrl = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  return new Response("Not yet.", { status: 403 })
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method === "GET") return getLongUrl(request, env, ctx)
    if (request.method === "POST") return createShortUrl(request, env, ctx)
    return new Response("Not found", { status: 404 })
  },
} satisfies ExportedHandler<Env>
