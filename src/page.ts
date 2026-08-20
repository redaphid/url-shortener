export const page = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>2cb.pw</title>
<style>
	:root {
		--bg: #fbfbfa; --fg: #1b1b19; --muted: #6b6b66; --line: #e2e1dc;
		--card: #ffffff; --accent: #b5502a; --accent-fg: #ffffff;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--bg: #16161a; --fg: #ecebe7; --muted: #98978f; --line: #2e2e34;
			--card: #1e1e23; --accent: #e07a52; --accent-fg: #16161a;
		}
	}
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 2rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
		font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
	}
	main { max-width: 34rem; margin: 0 auto; }
	h1 { font-size: 1.5rem; margin: 0 0 1.5rem; letter-spacing: -0.02em; }
	h1 span { color: var(--muted); font-weight: 400; }
	label { display: block; font-size: 0.8rem; color: var(--muted); margin: 0 0 0.35rem; }
	input {
		width: 100%; padding: 0.7rem 0.8rem; border: 1px solid var(--line); border-radius: 8px;
		background: var(--card); color: var(--fg); font: inherit; font-size: 1rem;
	}
	input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
	.row { display: flex; gap: 0.6rem; margin-top: 0.9rem; }
	.row > * { flex: 1; }
	button {
		padding: 0.7rem 1rem; border: 0; border-radius: 8px; background: var(--accent);
		color: var(--accent-fg); font: inherit; font-weight: 600; cursor: pointer;
	}
	button:disabled { opacity: 0.5; cursor: default; }
	button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); font-weight: 400; }
	#out { margin-top: 1rem; font-size: 0.95rem; min-height: 1.5rem; }
	#out a { color: var(--accent); font-weight: 600; text-decoration: none; word-break: break-all; }
	#out.err { color: #c0392b; }
	ul { list-style: none; padding: 0; margin: 2rem 0 0; border-top: 1px solid var(--line); }
	li { display: flex; align-items: baseline; gap: 0.6rem; padding: 0.7rem 0; border-bottom: 1px solid var(--line); }
	li .slug { font-weight: 600; white-space: nowrap; color: var(--fg); text-decoration: none; }
	li .slug:hover { color: var(--accent); }
	li .long { color: var(--muted); font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
	li button { padding: 0.2rem 0.5rem; font-size: 0.75rem; }
	details { margin-top: 2rem; font-size: 0.85rem; color: var(--muted); }
	summary { cursor: pointer; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
	pre { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 0.8rem; }
</style>
</head>
<body>
<main>
	<h1>2cb.pw <span>— shorten a link</span></h1>

	<form id="f">
		<label for="url">Long URL</label>
		<input id="url" name="url" type="url" placeholder="https://example.com/something/long" required autofocus>
		<div class="row">
			<input id="slug" name="slug" placeholder="custom slug (optional)" autocapitalize="off" autocorrect="off" spellcheck="false">
			<button type="submit">Shorten</button>
		</div>
		<div class="row">
			<input id="token" type="password" placeholder="token" autocomplete="current-password">
		</div>
	</form>

	<div id="out"></div>
	<ul id="list"></ul>

	<details>
		<summary>Use it from a terminal</summary>
		<pre><code>curl -H "Authorization: Bearer $TOKEN" -d https://example.com https://2cb.pw/
curl -H "Authorization: Bearer $TOKEN" -d https://example.com https://2cb.pw/myslug</code></pre>
	</details>
</main>
<script>
const $ = (id) => document.getElementById(id)
const token = () => $("token").value.trim()
$("token").value = localStorage.getItem("token") || ""
$("token").addEventListener("change", () => { localStorage.setItem("token", token()); load() })

const headers = () => ({ "authorization": "Bearer " + token(), "accept": "application/json" })

const say = (html, isError) => { $("out").className = isError ? "err" : ""; $("out").innerHTML = html }

const copy = (text) => navigator.clipboard && navigator.clipboard.writeText(text)

$("f").addEventListener("submit", async (event) => {
	event.preventDefault()
	if (!token()) return say("Enter your token first.", true)
	say("…")
	const slug = $("slug").value.trim()
	const response = await fetch("/" + slug, {
		method: slug ? "PUT" : "POST",
		headers: Object.assign({ "content-type": "application/json" }, headers()),
		body: JSON.stringify({ url: $("url").value.trim() })
	})
	const text = await response.text()
	if (!response.ok) return say(text || response.status, true)
	const link = JSON.parse(text).shortUrl
	copy(link)
	say('<a href="' + link + '">' + link + '</a> — copied')
	$("url").value = ""
	$("slug").value = ""
	load()
})

const load = async () => {
	if (!token()) return
	const response = await fetch("/", { headers: headers() })
	if (!response.ok) return
	const links = (await response.json()).links
	$("list").innerHTML = ""
	for (const link of links) {
		const li = document.createElement("li")
		const slug = document.createElement("a")
		slug.className = "slug"
		slug.href = "/" + link.slug
		slug.textContent = "/" + link.slug
		const long = document.createElement("span")
		long.className = "long"
		long.textContent = link.url
		const copyButton = document.createElement("button")
		copyButton.className = "ghost"
		copyButton.textContent = "copy"
		copyButton.onclick = () => { copy(location.origin + "/" + link.slug); copyButton.textContent = "copied" }
		const removeButton = document.createElement("button")
		removeButton.className = "ghost"
		removeButton.textContent = "delete"
		removeButton.onclick = async () => {
			await fetch("/" + link.slug, { method: "DELETE", headers: headers() })
			load()
		}
		li.append(slug, long, copyButton, removeButton)
		$("list").append(li)
	}
}
load()
</script>
</body>
</html>
`
