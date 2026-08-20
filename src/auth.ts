// Constant-time string compare, so a wrong token leaks nothing through timing
const equals = (a: string, b: string): boolean => {
	const left = new TextEncoder().encode(a)
	const right = new TextEncoder().encode(b)
	if (left.length !== right.length) return false
	let diff = 0
	for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i]
	return diff === 0
}

export const isAuthorized = (request: Request, env: Env): boolean => {
	if (!env.SHORTENER_TOKEN) return false
	const header = request.headers.get("authorization") ?? ""
	const [scheme, token] = header.split(" ")
	if (scheme?.toLowerCase() !== "bearer" || !token) return false
	return equals(token, env.SHORTENER_TOKEN)
}

export const unauthorized = (): Response =>
	new Response("Unauthorized\n", {
		status: 401,
		headers: { "www-authenticate": 'Bearer realm="2cb.pw"' }
	})
