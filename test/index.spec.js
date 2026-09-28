import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const AUTH = { 'X-Upload-Token': 'test-token' };

// Storage isolation is off (see vitest.config.js), so each test starts from a clean slate here.
beforeEach(async () => {
	const { keys } = await env.URL_MAP.list();
	await Promise.all(keys.map(({ name }) => env.URL_MAP.delete(name)));
	const { objects } = await env.FILES.list();
	await Promise.all(objects.map(({ key }) => env.FILES.delete(key)));
});

describe('reading', () => {
	it('serves the published UI at the root', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?root=1&name=index.html&type=text/html', {
			method: 'POST',
			headers: AUTH,
			body: '<h1>Drop files here</h1><button>Shorten</button>',
		});

		const response = await SELF.fetch('https://2cb.pw/');
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('Drop files here');
		expect(response.headers.get('content-type')).toContain('text/html');
	});

	it('lets the root UI revalidate instead of pinning it forever', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?root=1&name=index.html&type=text/html', {
			method: 'POST',
			headers: AUTH,
			body: '<h1>first</h1>',
		});
		const response = await SELF.fetch('https://2cb.pw/');
		expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');

		// Republishing must actually replace what the root serves.
		await SELF.fetch('https://2cb.pw/api/upload?root=1&name=index.html&type=text/html', {
			method: 'POST',
			headers: AUTH,
			body: '<h1>second</h1>',
		});
		expect(await (await SELF.fetch('https://2cb.pw/')).text()).toContain('second');
	});

	it('404s the root when no UI has been published', async () => {
		const response = await SELF.fetch('https://2cb.pw/');
		expect(response.status).toBe(404);
	});

	it('keeps uploads pinned immutably', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?name=a.txt&type=text/plain&code=cc1', {
			method: 'POST',
			headers: AUTH,
			body: 'x',
		});
		const response = await SELF.fetch('https://2cb.pw/cc1');
		expect(response.headers.get('cache-control')).toContain('immutable');
	});

	it('sends /up, the Access door, to the UI', async () => {
		const response = await SELF.fetch('https://2cb.pw/up', { redirect: 'manual' });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('https://2cb.pw/');
	});

	it('redirects a short code to its target', async () => {
		await env.URL_MAP.put('abc', JSON.stringify({ type: 'url', url: 'https://example.com/target' }));
		const response = await SELF.fetch('https://2cb.pw/abc', { redirect: 'manual' });
		expect(response.status).toBe(301);
		expect(response.headers.get('location')).toBe('https://example.com/target');
	});

	it('still redirects links stored in the old bare-string format', async () => {
		await env.URL_MAP.put('legacy', 'https://example.com/old');
		const response = await SELF.fetch('https://2cb.pw/legacy', { redirect: 'manual' });
		expect(response.status).toBe(301);
		expect(response.headers.get('location')).toBe('https://example.com/old');
	});

	it('404s an unknown code', async () => {
		const response = await SELF.fetch('https://2cb.pw/nope');
		expect(response.status).toBe(404);
	});
});

describe('shortening', () => {
	it('creates a code and returns the short url', async () => {
		const response = await SELF.fetch('https://2cb.pw/api/shorten', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: 'https://example.com/long', code: 'mine' }),
		});
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ code: 'mine', url: 'https://2cb.pw/mine' });
	});

	it('generates an office-number style code when none is given', async () => {
		const response = await SELF.fetch('https://2cb.pw/api/shorten', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: 'https://example.com/long' }),
		});
		const { code } = await response.json();
		expect(code).toMatch(/^[a-z]{3}\.[a-z]{3}\.[a-z]{4}$/);
	});

	it('refuses a code that is already taken', async () => {
		await env.URL_MAP.put('taken', 'https://example.com/first');
		const response = await SELF.fetch('https://2cb.pw/api/shorten', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: 'https://example.com/second', code: 'taken' }),
		});
		expect(response.status).toBe(409);
	});

	it('rejects a non-http target', async () => {
		const response = await SELF.fetch('https://2cb.pw/api/shorten', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: 'javascript:alert(1)' }),
		});
		expect(response.status).toBe(400);
	});
});

describe('file hosting', () => {
	const uploadText = (body, { name = 'hello.txt', type = 'text/plain', code } = {}) => {
		const query = new URLSearchParams({ name, type });
		if (code) query.set('code', code);
		return SELF.fetch(`https://2cb.pw/api/upload?${query}`, { method: 'POST', headers: AUTH, body });
	};

	it('stores an uploaded file and serves it back', async () => {
		const created = await uploadText('hello world', { code: 'f1' });
		expect(created.status).toBe(201);

		const served = await SELF.fetch('https://2cb.pw/f1');
		expect(served.status).toBe(200);
		expect(await served.text()).toBe('hello world');
		expect(served.headers.get('content-type')).toContain('text/plain');
		expect(served.headers.get('content-disposition')).toContain('inline');
	});

	it('forces a download when asked', async () => {
		await uploadText('hello world', { code: 'f2' });
		const served = await SELF.fetch('https://2cb.pw/f2?dl');
		expect(served.headers.get('content-disposition')).toContain('attachment');
	});

	it('sends a binary file as an attachment', async () => {
		await uploadText('data', { name: 'thing.bin', type: 'application/octet-stream', code: 'f3' });
		const served = await SELF.fetch('https://2cb.pw/f3');
		expect(served.headers.get('content-disposition')).toContain('attachment');
		expect(served.headers.get('content-disposition')).toContain('thing.bin');
	});

	it('serves a byte range', async () => {
		await uploadText('0123456789', { code: 'f4' });
		const served = await SELF.fetch('https://2cb.pw/f4', { headers: { Range: 'bytes=2-4' } });
		expect(served.status).toBe(206);
		expect(await served.text()).toBe('234');
		expect(served.headers.get('content-range')).toBe('bytes 2-4/10');
	});

	it('deletes the file along with the code', async () => {
		await uploadText('bye', { code: 'f5' });
		const response = await SELF.fetch('https://2cb.pw/api/delete', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: 'f5' }),
		});
		expect(await response.json()).toEqual({ deleted: true });
		expect(await SELF.fetch('https://2cb.pw/f5')).toMatchObject({ status: 404 });
	});

	it('uploads a large file in parts', async () => {
		const created = await SELF.fetch('https://2cb.pw/api/multipart/create', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'big.bin', type: 'application/octet-stream', code: 'big' }),
		});
		const { code, key, uploadId } = await created.json();

		// A held code is not yet readable, so a second upload cannot steal it.
		expect(await SELF.fetch('https://2cb.pw/big')).toMatchObject({ status: 409 });

		const chunks = ['a'.repeat(6 * 1024 * 1024), 'b'.repeat(16)];
		const parts = [];
		for (const [index, chunk] of chunks.entries()) {
			const query = new URLSearchParams({ key, uploadId, part: String(index + 1) });
			const response = await SELF.fetch(`https://2cb.pw/api/multipart/part?${query}`, {
				method: 'PUT',
				headers: AUTH,
				body: chunk,
			});
			expect(response.status).toBe(200);
			parts.push(await response.json());
		}

		const completed = await SELF.fetch('https://2cb.pw/api/multipart/complete', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ code, key, uploadId, name: 'big.bin', type: 'application/octet-stream', parts }),
		});
		expect(completed.status).toBe(201);

		const served = await SELF.fetch('https://2cb.pw/big', { headers: { Range: 'bytes=0-3' } });
		expect(await served.text()).toBe('aaaa');
	});
});

describe('authorization', () => {
	it('refuses an upload with no credentials', async () => {
		const response = await SELF.fetch('https://2cb.pw/api/upload?name=x.txt', { method: 'POST', body: 'x' });
		expect(response.status).toBe(403);
	});

	it('refuses an upload with the wrong token', async () => {
		const response = await SELF.fetch('https://2cb.pw/api/upload?name=x.txt', {
			method: 'POST',
			headers: { 'X-Upload-Token': 'wrong' },
			body: 'x',
		});
		expect(response.status).toBe(403);
	});

	it('leaves reads public', async () => {
		await env.URL_MAP.put('open', 'https://example.com/open');
		const response = await SELF.fetch('https://2cb.pw/open', { redirect: 'manual' });
		expect(response.status).toBe(301);
	});
});

describe('cache policy', () => {
	it('defaults an upload to permanent, for offline use', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?name=a.txt&type=text/plain&code=cp1', {
			method: 'POST',
			headers: AUTH,
			body: 'x',
		});
		const response = await SELF.fetch('https://2cb.pw/cp1');
		expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
	});

	it('honours a chosen preset', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?name=a.txt&type=text/plain&code=cp2&cache=hour', {
			method: 'POST',
			headers: AUTH,
			body: 'x',
		});
		const response = await SELF.fetch('https://2cb.pw/cp2');
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
	});

	it('accepts a raw number of seconds', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?name=a.txt&type=text/plain&code=cp3&cache=90', {
			method: 'POST',
			headers: AUTH,
			body: 'x',
		});
		const response = await SELF.fetch('https://2cb.pw/cp3');
		expect(response.headers.get('cache-control')).toBe('public, max-age=90');
	});

	it('falls back to permanent for a value it does not understand', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?name=a.txt&type=text/plain&code=cp4&cache=wat', {
			method: 'POST',
			headers: AUTH,
			body: 'x',
		});
		const response = await SELF.fetch('https://2cb.pw/cp4');
		expect(response.headers.get('cache-control')).toContain('immutable');
	});

	it('sends a permanent link as a 301, and a perishable one as a 302', async () => {
		const shorten = (code, cache) =>
			SELF.fetch('https://2cb.pw/api/shorten', {
				method: 'POST',
				headers: { ...AUTH, 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: 'https://example.com/x', code, cache }),
			});

		await shorten('cp5');
		await shorten('cp6', 'none');

		const permanent = await SELF.fetch('https://2cb.pw/cp5', { redirect: 'manual' });
		expect(permanent.status).toBe(301);
		expect(permanent.headers.get('cache-control')).toContain('immutable');

		// A 301 would be pinned by the browser regardless of the header, so it must not be one.
		const perishable = await SELF.fetch('https://2cb.pw/cp6', { redirect: 'manual' });
		expect(perishable.status).toBe(302);
		expect(perishable.headers.get('cache-control')).toBe('no-store');
	});
});

describe('browsing', () => {
	it('lists links and files with enough detail to identify them', async () => {
		await env.URL_MAP.put('old-link', 'https://example.com/legacy');
		await SELF.fetch('https://2cb.pw/api/shorten', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: 'https://example.com/new', code: 'new-link' }),
		});
		await SELF.fetch('https://2cb.pw/api/upload?name=photo.jpg&type=image/jpeg&code=a-file', {
			method: 'POST',
			headers: AUTH,
			body: 'jpegbytes',
		});

		const { items } = await (await SELF.fetch('https://2cb.pw/api/list', { headers: AUTH })).json();
		const byCode = Object.fromEntries(items.map((item) => [item.code, item]));

		expect(byCode['a-file']).toMatchObject({ type: 'file', name: 'photo.jpg', size: 9 });
		expect(byCode['new-link']).toMatchObject({ type: 'url', url: 'https://example.com/new' });
		// The whole point: a legacy bare-string link must still show its target.
		expect(byCode['old-link']).toMatchObject({ type: 'url', url: 'https://example.com/legacy' });
	});

	it('sorts newest first and hides the UI record', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?root=1&name=index.html&type=text/html', {
			method: 'POST',
			headers: AUTH,
			body: '<h1>ui</h1>',
		});
		await env.URL_MAP.put('undated', 'https://example.com/undated');
		await SELF.fetch('https://2cb.pw/api/shorten', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: 'https://example.com/fresh', code: 'fresh' }),
		});

		const { items } = await (await SELF.fetch('https://2cb.pw/api/list', { headers: AUTH })).json();
		expect(items.map((item) => item.code)).toEqual(['fresh', 'undated']);
	});

	it('needs authorization to browse', async () => {
		const response = await SELF.fetch('https://2cb.pw/api/list');
		expect(response.status).toBe(403);
	});
});

/**
 * Builds a real zip in memory. Entries are deflated unless `store` is set, so both of the
 * methods zip tools write get exercised. CRCs are computed properly so the fixtures would
 * open in any unzip tool, even though the Worker does not check them.
 */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (bytes) => {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
};
const deflateRaw = async (bytes) =>
	new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

const makeZip = async (files, { store = false } = {}) => {
	const encoder = new TextEncoder();
	const locals = [];
	const centrals = [];
	let offset = 0;

	for (const [name, content] of Object.entries(files)) {
		const nameBytes = encoder.encode(name);
		const data = typeof content === 'string' ? encoder.encode(content) : content;
		const isDirectory = name.endsWith('/');
		const method = store || isDirectory ? 0 : 8;
		const packed = method === 8 ? await deflateRaw(data) : data;

		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(4, 20, true);
		local.setUint16(6, 0x800, true);
		local.setUint16(8, method, true);
		local.setUint32(14, crc32(data), true);
		local.setUint32(18, packed.byteLength, true);
		local.setUint32(22, data.byteLength, true);
		local.setUint16(26, nameBytes.byteLength, true);
		locals.push(new Uint8Array(local.buffer), nameBytes, packed);

		const central = new DataView(new ArrayBuffer(46));
		central.setUint32(0, 0x02014b50, true);
		central.setUint16(4, 20, true);
		central.setUint16(6, 20, true);
		central.setUint16(8, 0x800, true);
		central.setUint16(10, method, true);
		central.setUint32(16, crc32(data), true);
		central.setUint32(20, packed.byteLength, true);
		central.setUint32(24, data.byteLength, true);
		central.setUint16(28, nameBytes.byteLength, true);
		central.setUint32(42, offset, true);
		centrals.push(new Uint8Array(central.buffer), nameBytes);

		offset += 30 + nameBytes.byteLength + packed.byteLength;
	}

	const directorySize = centrals.reduce((total, part) => total + part.byteLength, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, Object.keys(files).length, true);
	end.setUint16(10, Object.keys(files).length, true);
	end.setUint32(12, directorySize, true);
	end.setUint32(16, offset, true);

	return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)]);
};

const uploadZip = (zip, query) =>
	SELF.fetch(`https://2cb.pw/api/upload?${new URLSearchParams({ type: 'application/zip', ...query })}`, {
		method: 'POST',
		headers: AUTH,
		body: zip,
	});

// The keeper's log: a small site that should come out of its archive exactly as it went in.
const LOGBOOK = {
	'logbook/index.html': '<h1>Keeper\'s log</h1><link rel="stylesheet" href="lamp.css">',
	'logbook/lamp.css': 'h1 { color: #ffb000; }',
	'logbook/nights/index.html': '<p>The lamp was lit at dusk.</p>',
	'logbook/nights/0412.txt': 'Fog. Horn every thirty seconds. No ships.',
	'logbook/404.html': '<p>That page was lost at sea.</p>',
	'__MACOSX/logbook/._index.html': 'resource fork',
	'logbook/.DS_Store': 'finder litter',
	'logbook/nights/': '',
};

describe('zip sites', () => {
	it('unpacks an uploaded zip and serves it under the chosen code', async () => {
		const response = await uploadZip(await makeZip(LOGBOOK), { name: 'logbook.zip', code: 'keeper' });
		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({ code: 'keeper', url: 'https://2cb.pw/keeper/', files: 5 });

		const index = await SELF.fetch('https://2cb.pw/keeper/');
		expect(index.status).toBe(200);
		expect(index.headers.get('content-type')).toContain('text/html');
		expect(await index.text()).toContain("Keeper's log");

		const css = await SELF.fetch('https://2cb.pw/keeper/lamp.css');
		expect(css.headers.get('content-type')).toContain('text/css');
		expect(css.headers.get('content-disposition')).toMatch(/^inline/);
		expect(await css.text()).toContain('#ffb000');

		expect(await (await SELF.fetch('https://2cb.pw/keeper/nights/0412.txt')).text()).toContain('No ships');
	});

	it('peels off the single folder a zip tool wraps everything in, and drops Mac litter', async () => {
		await uploadZip(await makeZip(LOGBOOK), { name: 'logbook.zip', code: 'peeled' });
		const { objects } = await env.FILES.list({ prefix: 'peeled/' });
		expect(objects.map(({ key }) => key).sort()).toEqual([
			'peeled/site/404.html',
			'peeled/site/index.html',
			'peeled/site/lamp.css',
			'peeled/site/nights/0412.txt',
			'peeled/site/nights/index.html',
		]);
	});

	it('keeps top-level paths when there is no single wrapper folder', async () => {
		await uploadZip(await makeZip({ 'index.html': 'root', 'js/app.js': 'go()' }, { store: true }), { name: 'flat.zip', code: 'flat' });
		expect(await (await SELF.fetch('https://2cb.pw/flat/')).text()).toBe('root');
		const script = await SELF.fetch('https://2cb.pw/flat/js/app.js');
		expect(script.headers.get('content-type')).toContain('text/javascript');
		expect(await script.text()).toBe('go()');
	});

	it('adds the trailing slash so relative links resolve inside the site', async () => {
		await uploadZip(await makeZip(LOGBOOK), { name: 'logbook.zip', code: 'slash' });
		const bare = await SELF.fetch('https://2cb.pw/slash?from=sea', { redirect: 'manual' });
		expect(bare.status).toBe(301);
		expect(bare.headers.get('location')).toBe('/slash/?from=sea');

		const directory = await SELF.fetch('https://2cb.pw/slash/nights', { redirect: 'manual' });
		expect(directory.status).toBe(301);
		expect(directory.headers.get('location')).toBe('/slash/nights/');
		expect(await (await SELF.fetch('https://2cb.pw/slash/nights/')).text()).toContain('lit at dusk');
	});

	it("serves the site's own 404 page for a missing path", async () => {
		await uploadZip(await makeZip(LOGBOOK), { name: 'logbook.zip', code: 'lost' });
		const response = await SELF.fetch('https://2cb.pw/lost/nights/0413.txt');
		expect(response.status).toBe(404);
		expect(await response.text()).toContain('lost at sea');
	});

	it('404s plainly when the site has no 404 page', async () => {
		await uploadZip(await makeZip({ 'index.html': 'hi' }), { name: 'tiny.zip', code: 'tiny' });
		expect(await SELF.fetch('https://2cb.pw/tiny/nope.png')).toMatchObject({ status: 404 });
	});

	it('does not keep the archive around after unpacking it', async () => {
		await uploadZip(await makeZip(LOGBOOK), { name: 'logbook.zip', code: 'noarchive' });
		expect(await env.FILES.head('noarchive/logbook.zip')).toBeNull();
	});

	it('stores the zip as an ordinary file when asked not to extract', async () => {
		const zip = await makeZip(LOGBOOK);
		await uploadZip(zip, { name: 'logbook.zip', code: 'packed', extract: '0' });
		const response = await SELF.fetch('https://2cb.pw/packed');
		expect(response.status).toBe(200);
		expect((await response.arrayBuffer()).byteLength).toBe(zip.size);
	});

	it('refuses a broken archive and leaves the code free', async () => {
		const response = await uploadZip('this is not a zip at all, just a message in a bottle', { name: 'bottle.zip', code: 'bottle' });
		expect(response.status).toBe(422);
		expect((await response.json()).error).toMatch(/zip/i);
		expect(await env.URL_MAP.get('bottle')).toBeNull();
		expect((await env.FILES.list({ prefix: 'bottle/' })).objects).toHaveLength(0);
	});

	it('deletes every file of a site along with its code', async () => {
		await uploadZip(await makeZip(LOGBOOK), { name: 'logbook.zip', code: 'razed' });
		await SELF.fetch('https://2cb.pw/api/delete', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: 'razed' }),
		});
		expect((await env.FILES.list({ prefix: 'razed/' })).objects).toHaveLength(0);
		expect(await SELF.fetch('https://2cb.pw/razed/')).toMatchObject({ status: 404 });
	});

	it('lists a site in the browse view', async () => {
		await uploadZip(await makeZip(LOGBOOK), { name: 'logbook.zip', code: 'listed' });
		const { items } = await (await SELF.fetch('https://2cb.pw/api/list', { headers: AUTH })).json();
		expect(items).toEqual([expect.objectContaining({ code: 'listed', type: 'site', name: 'logbook.zip', files: 5 })]);
		expect(items[0]).not.toHaveProperty('prefix');
	});

	it('unpacks a zip that arrived in parts', async () => {
		// R2 needs every part but the last to be at least 5 MiB, so the archive carries ballast.
		const ballast = new Uint8Array(6 * 1024 * 1024).fill(7);
		const zip = new Uint8Array(await (await makeZip({ 'index.html': 'heavy seas', 'ballast.bin': ballast }, { store: true })).arrayBuffer());

		const created = await SELF.fetch('https://2cb.pw/api/multipart/create', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'heavy.zip', type: 'application/zip', code: 'heavy' }),
		});
		const { code, key, uploadId } = await created.json();

		const cut = 5 * 1024 * 1024;
		const parts = [];
		for (const [index, chunk] of [zip.subarray(0, cut), zip.subarray(cut)].entries()) {
			const query = new URLSearchParams({ key, uploadId, part: String(index + 1) });
			const response = await SELF.fetch(`https://2cb.pw/api/multipart/part?${query}`, { method: 'PUT', headers: AUTH, body: chunk });
			parts.push(await response.json());
		}

		const completed = await SELF.fetch('https://2cb.pw/api/multipart/complete', {
			method: 'POST',
			headers: { ...AUTH, 'Content-Type': 'application/json' },
			body: JSON.stringify({ code, key, uploadId, name: 'heavy.zip', type: 'application/zip', parts }),
		});
		expect(completed.status).toBe(201);
		expect(await (await SELF.fetch('https://2cb.pw/heavy/')).text()).toBe('heavy seas');
		expect((await (await SELF.fetch('https://2cb.pw/heavy/ballast.bin')).arrayBuffer()).byteLength).toBe(ballast.byteLength);
	});
});

describe('subpaths', () => {
	it('carries the rest of the path over onto a link target', async () => {
		await env.URL_MAP.put('docs', JSON.stringify({ type: 'url', url: 'https://example.com/manual/' }));
		const response = await SELF.fetch('https://2cb.pw/docs/chapter%202/tides', { redirect: 'manual' });
		expect(response.headers.get('location')).toBe('https://example.com/manual/chapter%202/tides');
	});

	it('prefers the longest matching key', async () => {
		await env.URL_MAP.put('app', 'https://example.com/app');
		await env.URL_MAP.put('app/list', 'https://example.com/special-list');
		const exact = await SELF.fetch('https://2cb.pw/app/list', { redirect: 'manual' });
		expect(exact.headers.get('location')).toBe('https://example.com/special-list');
		const deeper = await SELF.fetch('https://2cb.pw/app/list/7', { redirect: 'manual' });
		expect(deeper.headers.get('location')).toBe('https://example.com/special-list/7');
	});

	it('gives a scheme to hand-set links stored without one', async () => {
		await env.URL_MAP.put('bare', 'example.com/harbour');
		const response = await SELF.fetch('https://2cb.pw/bare/master', { redirect: 'manual' });
		expect(response.headers.get('location')).toBe('https://example.com/harbour/master');
	});

	it('does not invent paths inside a single hosted file', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?name=a.txt&type=text/plain&code=single', { method: 'POST', headers: AUTH, body: 'x' });
		expect(await SELF.fetch('https://2cb.pw/single/more')).toMatchObject({ status: 404 });
	});

	it('never reaches the UI record through a path', async () => {
		await SELF.fetch('https://2cb.pw/api/upload?root=1&name=index.html&type=text/html', { method: 'POST', headers: AUTH, body: 'ui' });
		expect(await SELF.fetch('https://2cb.pw/_root/index.html')).toMatchObject({ status: 404 });
	});
});
