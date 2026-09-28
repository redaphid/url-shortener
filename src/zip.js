/**
 * Unpacks a zip archive that is already sitting in R2 into a tree of ordinary R2 objects.
 *
 * Nothing here holds a whole archive in memory unless it is small. Each entry is streamed out
 * of the archive, through a raw-deflate decompressor, and into R2 with its length declared up
 * front (which R2 needs for a stream). Small archives are read once and sliced, which keeps
 * the number of R2 calls per upload close to one per file.
 *
 * Supports the two methods every zip tool actually writes: stored (0) and deflate (8).
 * ZIP64 and encrypted entries are refused rather than half-extracted.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_MAX = EOCD_MIN + 0xffff;

/** Archives up to this size are read in one go rather than by range. */
const BUFFER_LIMIT = 16 * 1024 * 1024;

/** Workers allow six simultaneous open connections; stay just under it. */
const CONCURRENCY = 5;

export class ZipError extends Error {}

const CONTENT_TYPES = {
	html: 'text/html; charset=utf-8',
	htm: 'text/html; charset=utf-8',
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	json: 'application/json',
	map: 'application/json',
	webmanifest: 'application/manifest+json',
	txt: 'text/plain; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	xml: 'application/xml',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	ico: 'image/x-icon',
	wasm: 'application/wasm',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	mp4: 'video/mp4',
	webm: 'video/webm',
	pdf: 'application/pdf',
};

export const contentTypeFor = (path) => {
	const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
	return CONTENT_TYPES[extension] || 'application/octet-stream';
};

export const looksLikeZip = (name, type) => /\.zip$/i.test(name || '') || /^application\/(x-)?zip(-compressed)?$/i.test(type || '');

const bufferSource = (bytes) => ({
	size: bytes.byteLength,
	bytes: async (offset, length) => bytes.subarray(offset, offset + length),
	stream: async (offset, length) => new Blob([bytes.subarray(offset, offset + length)]).stream(),
});

const r2Source = (bucket, key, size) => {
	const read = async (offset, length) => {
		const object = await bucket.get(key, { range: { offset, length } });
		if (!object) throw new ZipError('The archive vanished while it was being unpacked');
		return object;
	};
	return {
		size,
		bytes: async (offset, length) => new Uint8Array(await (await read(offset, length)).arrayBuffer()),
		stream: async (offset, length) => (await read(offset, length)).body,
	};
};

const openSource = async (bucket, key) => {
	const head = await bucket.head(key);
	if (!head) throw new ZipError('The archive was not stored');
	if (head.size > BUFFER_LIMIT) return r2Source(bucket, key, head.size);
	const object = await bucket.get(key);
	return bufferSource(new Uint8Array(await object.arrayBuffer()));
};

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const readDirectory = async (source) => {
	if (source.size < EOCD_MIN) throw new ZipError('Not a zip archive');

	// The end record sits in the last 22 bytes plus however long the archive comment is.
	const tailLength = Math.min(source.size, EOCD_MAX);
	const tail = await source.bytes(source.size - tailLength, tailLength);
	const tailView = view(tail);
	let end = -1;
	for (let at = tail.byteLength - EOCD_MIN; at >= 0; at -= 1) {
		if (tailView.getUint32(at, true) === EOCD_SIGNATURE) {
			end = at;
			break;
		}
	}
	if (end < 0) throw new ZipError('Not a zip archive');

	const count = tailView.getUint16(end + 10, true);
	const directorySize = tailView.getUint32(end + 12, true);
	const directoryOffset = tailView.getUint32(end + 16, true);
	if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
		throw new ZipError('ZIP64 archives are not supported');
	}

	const directory = await source.bytes(directoryOffset, directorySize);
	const directoryView = view(directory);
	const decoder = new TextDecoder();
	const entries = [];

	for (let at = 0, index = 0; index < count; index += 1) {
		if (directoryView.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new ZipError('Corrupt zip directory');
		const nameLength = directoryView.getUint16(at + 28, true);
		const extraLength = directoryView.getUint16(at + 30, true);
		const commentLength = directoryView.getUint16(at + 32, true);
		entries.push({
			flags: directoryView.getUint16(at + 8, true),
			method: directoryView.getUint16(at + 10, true),
			compressedSize: directoryView.getUint32(at + 20, true),
			size: directoryView.getUint32(at + 24, true),
			localOffset: directoryView.getUint32(at + 42, true),
			name: decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)),
		});
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
};

/** Resource forks and Finder litter that zip tools on a Mac quietly include. */
const isLitter = (segments) => segments[0] === '__MACOSX' || segments[segments.length - 1] === '.DS_Store';

/**
 * Picks the entries worth publishing and the path each one is served at.
 *
 * "Compress folder" wraps everything in one top-level directory. Publishing that as-is would
 * put the site at /code/folder/, so a lone wrapper directory is peeled off.
 */
const plan = (entries) => {
	const files = [];
	for (const entry of entries) {
		if (entry.name.endsWith('/')) continue;
		const segments = entry.name.replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.');
		if (segments.length === 0 || segments.includes('..') || isLitter(segments)) continue;
		if (entry.flags & 0x1) throw new ZipError(`"${entry.name}" is encrypted`);
		if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`"${entry.name}" uses an unsupported compression method`);
		if (entry.size === 0xffffffff || entry.compressedSize === 0xffffffff) throw new ZipError('ZIP64 archives are not supported');
		files.push({ ...entry, segments });
	}
	if (files.length === 0) throw new ZipError('The archive has no files in it');

	const wrapper = files[0].segments[0];
	const wrapped = files.every(({ segments }) => segments.length > 1 && segments[0] === wrapper);
	return files.map((file) => ({ ...file, path: (wrapped ? file.segments.slice(1) : file.segments).join('/') }));
};

const entryStream = async (source, entry) => {
	// The local header repeats the name and carries its own extra field, whose length can
	// differ from the directory's copy, so it has to be read to find where the data starts.
	const header = view(await source.bytes(entry.localOffset, 30));
	if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipError(`Corrupt entry "${entry.name}"`);
	const dataOffset = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);

	const raw = await source.stream(dataOffset, entry.compressedSize);
	const inflated = entry.method === 8 ? raw.pipeThrough(new DecompressionStream('deflate-raw')) : raw;
	return inflated.pipeThrough(new FixedLengthStream(entry.size));
};

const inPool = async (items, limit, work) => {
	let next = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) await work(items[next++]);
	});
	await Promise.all(runners);
};

/**
 * Unpacks the archive at `archiveKey` so each file lands at `prefix + path`.
 * On failure, whatever was already written under the prefix is removed again.
 *
 * @returns {Promise<{ files: number, size: number }>}
 */
export const extractZip = async (bucket, archiveKey, prefix) => {
	const source = await openSource(bucket, archiveKey);
	const files = plan(await readDirectory(source));

	try {
		await inPool(files, CONCURRENCY, async (file) => {
			await bucket.put(prefix + file.path, await entryStream(source, file), {
				httpMetadata: { contentType: contentTypeFor(file.path) },
			});
		});
	} catch (error) {
		await deletePrefix(bucket, prefix);
		throw error instanceof ZipError ? error : new ZipError(`Could not unpack the archive: ${error.message}`);
	}

	return { files: files.length, size: files.reduce((total, file) => total + file.size, 0) };
};

/** R2 deletes at most 1000 keys per call, and lists at most 1000 per page. */
export const deletePrefix = async (bucket, prefix) => {
	let cursor;
	do {
		const page = await bucket.list({ prefix, cursor });
		if (page.objects.length) await bucket.delete(page.objects.map(({ key }) => key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
};
