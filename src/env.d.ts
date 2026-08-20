// Secrets aren't in wrangler.jsonc, so declare them onto the generated Env.
declare namespace Cloudflare {
	interface Env {
		SHORTENER_TOKEN: string
	}
}
