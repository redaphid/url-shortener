import { env, SELF } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"

const TOKEN = "test-token"
const auth = { authorization: `Bearer ${TOKEN}`, accept: "application/json" }

// SHORTENER_TOKEN is bound to this value in vitest.config.mts
const TOKEN_MATCHES_CONFIG = TOKEN

beforeEach(async () => {
	expect(env.SHORTENER_TOKEN).toBe(TOKEN_MATCHES_CONFIG)
	const { keys } = await env.short_urls.list()
	await Promise.all(keys.map(({ name }) => env.short_urls.delete(name)))
})

const post = (path: string, body: string, headers: Record<string, string> = auth) =>
	SELF.fetch(`https://2cb.pw/${path}`, { method: "POST", headers, body })

describe("creating links", () => {
	it("generates a slug when none is given", async () => {
		const response = await post("", "https://example.com/a/long/path")
		expect(response.status).toBe(201)
		const { slug, shortUrl, url } = (await response.json()) as Record<string, string>
		expect(slug).toHaveLength(8)
		expect(shortUrl).toBe(`https://2cb.pw/${slug}`)
		expect(url).toBe("https://example.com/a/long/path")
		expect(await env.short_urls.get(slug)).toBe("https://example.com/a/long/path")
	})

	it("replies in plain text unless asked for json, so curl stays readable", async () => {
		const response = await post("", "https://example.com", { authorization: `Bearer ${TOKEN}` })
		expect(await response.text()).toMatch(/^https:\/\/2cb\.pw\/\S{8}\n$/)
	})

	it("accepts a json body", async () => {
		const response = await post("blog", JSON.stringify({ url: "https://example.com/posts" }))
		expect(response.status).toBe(201)
		expect(await env.short_urls.get("blog")).toBe("https://example.com/posts")
	})

	it("adds a scheme to a bare host", async () => {
		await post("bare", "example.com/thing")
		expect(await env.short_urls.get("bare")).toBe("https://example.com/thing")
	})

	it("refuses to clobber an existing slug on POST", async () => {
		await post("taken", "https://example.com/first")
		const response = await post("taken", "https://example.com/second")
		expect(response.status).toBe(409)
		expect(await env.short_urls.get("taken")).toBe("https://example.com/first")
	})

	it("replaces on PUT", async () => {
		await post("taken", "https://example.com/first")
		const response = await SELF.fetch("https://2cb.pw/taken", {
			method: "PUT",
			headers: auth,
			body: "https://example.com/second"
		})
		expect(response.status).toBe(201)
		expect(await env.short_urls.get("taken")).toBe("https://example.com/second")
	})

	it("rejects junk bodies and reserved slugs", async () => {
		expect((await post("ok", "")).status).toBe(400)
		expect((await post("ok", "javascript:alert(1)")).status).toBe(400)
		expect((await post("api", "https://example.com")).status).toBe(400)
		expect((await post("has space", "https://example.com")).status).toBe(400)
	})
})

describe("auth", () => {
	it("rejects writes without a valid token", async () => {
		expect((await post("x", "https://example.com", { accept: "application/json" })).status).toBe(401)
		expect((await post("x", "https://example.com", { authorization: "Bearer nope" })).status).toBe(401)
		expect(await env.short_urls.get("x")).toBeNull()
	})

	it("rejects listing without a token", async () => {
		const response = await SELF.fetch("https://2cb.pw/", { headers: { accept: "application/json" } })
		expect(response.status).toBe(401)
	})
})

describe("redirecting", () => {
	it("redirects a known slug", async () => {
		await env.short_urls.put("blog", "https://example.com/posts")
		const response = await SELF.fetch("https://2cb.pw/blog", { redirect: "manual" })
		expect(response.status).toBe(301)
		expect(response.headers.get("location")).toBe("https://example.com/posts")
	})

	it("passes the rest of the path through", async () => {
		await env.short_urls.put("docs", "https://example.com/docs")
		const response = await SELF.fetch("https://2cb.pw/docs/guide/intro", { redirect: "manual" })
		expect(response.headers.get("location")).toBe("https://example.com/docs/guide/intro")
	})

	it("adds a scheme to legacy bare-host records", async () => {
		await env.short_urls.put("bare", "example.com")
		const response = await SELF.fetch("https://2cb.pw/bare", { redirect: "manual" })
		expect(response.headers.get("location")).toBe("https://example.com/")
	})

	it("404s an unknown slug", async () => {
		expect((await SELF.fetch("https://2cb.pw/nope", { redirect: "manual" })).status).toBe(404)
	})
})

describe("the root page", () => {
	it("serves the web UI to browsers", async () => {
		const response = await SELF.fetch("https://2cb.pw/")
		expect(response.headers.get("content-type")).toContain("text/html")
		expect(await response.text()).toContain("<title>2cb.pw</title>")
	})

	it("lists links for an authorized json request", async () => {
		await post("blog", "https://example.com/posts")
		const response = await SELF.fetch("https://2cb.pw/", { headers: auth })
		expect(await response.json()).toEqual({ links: [{ slug: "blog", url: "https://example.com/posts" }] })
	})
})

describe("deleting", () => {
	it("removes a link", async () => {
		await env.short_urls.put("gone", "https://example.com")
		const response = await SELF.fetch("https://2cb.pw/gone", { method: "DELETE", headers: auth })
		expect(response.status).toBe(200)
		expect(await env.short_urls.get("gone")).toBeNull()
	})
})
