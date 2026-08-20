// nanoid's standard url-safe alphabet, inlined so the worker stays dependency-free
const ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"

export const nanoid = (size = 8): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(size))
	let id = ""
	for (const byte of bytes) id += ALPHABET[byte & 63]
	return id
}

// Paths the worker itself needs, so a short link can never shadow them
const RESERVED = new Set(["", "api", "favicon.ico", "robots.txt", "health"])

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/

export const isValidSlug = (slug: string): boolean => {
	const segments = slug.split("/")
	if (segments.length > 4) return false
	if (RESERVED.has(segments[0])) return false
	return segments.every((segment) => SEGMENT.test(segment) && segment.length <= 64)
}
