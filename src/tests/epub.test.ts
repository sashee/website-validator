import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {Uint8ArrayWriter, ZipWriter, TextReader} from "@zip.js/zip.js";
import {initFailIds, setupTestFiles} from "./testutils.js";
import fs from "node:fs/promises";

const generateEpub = async (valid: boolean) => {
	// example based on https://github.com/thansen0/sample-epub-minimal
	const epubWriter = new Uint8ArrayWriter();
	const zipWriter = new ZipWriter(epubWriter);
	await zipWriter.add("mimetype", new TextReader("application/epub+zip"), {level: 0, extendedTimestamp: false});
	await zipWriter.add("META-INF/", undefined, {directory: true});
	await zipWriter.add("META-INF/container.xml", new TextReader(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
	</rootfiles>
</container>
																											 `));
	await zipWriter.add("OEBPS/", undefined, {directory: true});
	await zipWriter.add("OEBPS/content.opf", new TextReader(`<?xml version="1.0" encoding="UTF-8" ?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="db-id" version="3.0">

	<metadata>
		<dc:title id="t1">Minimal epub</dc:title>
		<dc:creator>test</dc:creator>
		<dc:identifier id="db-id">isbn</dc:identifier>
		<meta property="dcterms:modified">2014-03-27T09:14:09Z</meta>
		<dc:language>en</dc:language>
	</metadata>

	<manifest>
	${valid ? `
		<item properties="nav" id="nav.xhtml" href="nav.xhtml" media-type="application/xhtml+xml"/>
		` : ""}
		<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
		<item id="chapter_1" href="chapter_1.xhtml" media-type="application/xhtml+xml" />
	</manifest>

	<spine toc="ncx">
		<itemref idref="chapter_1" />
	</spine>
</package>
																											 `));
	await zipWriter.add("OEBPS/toc.ncx", new TextReader(`<?xml version="1.0" encoding="UTF-8" ?>
<ncx version="2005-1" xml:lang="en" xmlns="http://www.daisy.org/z3986/2005/ncx/">

	<head>
		<meta name="dtb:uid" content="isbn"/>
		<meta name="dtb:depth" content="1"/>
	</head>

	<docTitle>
		<text>Title</text>
	</docTitle>

	<navMap>
		<navPoint id="chapter_1" playOrder="1">
			<navLabel><text>Chapter 1</text></navLabel>
			<content src="chapter_1.xhtml" />
		</navPoint>
	</navMap>

</ncx>`));
	await zipWriter.add("OEBPS/nav.xhtml", new TextReader(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
	<title>toc.xhtml</title>
</head>
	<body>
		<nav id="toc" epub:type="toc">
			<h1 class="frontmatter">Table of Contents</h1>
			<ol class="contents">
						 <li><a href="chapter_1.xhtml">Chapter 1</a></li>
			</ol>
		</nav>
		</body>
		</html>`));
	await zipWriter.add("OEBPS/chapter_1.xhtml", new TextReader(`<?xml version="1.0" encoding="UTF-8" ?>
		<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
		<head>
		<title>chapter_1.xhtml</title>
	</head>

	<body>
<h1>Chapter 1</h1>
</body>
</html>`));
	await zipWriter.close();
	return Buffer.from(await epubWriter.getData());
};

describe("epub", () => {
	it("reports no errors for a valid epub file", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const epub = await generateEpub(true);
		const errors = await setupTestFiles([
			{
				filename: "index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<a href="test.epub">epub file</a>
	</body>
</html>
			`
			},
			{
				filename: "test.epub",
				contents: epub,
			}
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		assert.equal(errors.length, 0);
	});
	it("reports errors for an invalid epub file", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const epub = await generateEpub(false);
		const errors = await setupTestFiles([
			{
				filename: "index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<a href="test.epub">epub file</a>
	</body>
</html>
			`
			},
			{
				filename: "test.epub",
				contents: epub,
			}
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		const failIds = getFailIds();
		assert.equal(errors.length, 1);
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "EPUBCHECK" && error.location.url.includes("test.epub")), `Should have an error but did not: ${index}`);
		});
	});
});
