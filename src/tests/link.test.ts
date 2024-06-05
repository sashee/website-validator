import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {initFailIds, setupTestFiles} from "./testutils.js";
import fs from "node:fs/promises";
import url from "url";
import path from "node:path";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

describe.only("links", () => {
	it("inside html", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const errors = await setupTestFiles([{
			filename: "index.html",
			contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<h2 id="good">heading</h2>
		<!-- these links is good, as there is an element with that id -->
		<a href="#good">link2</a>
		<a href="https://example.com#good">link3</a>
		<a href="https://example.com/#good">link4</a>
		<a href="https://example.com/?query=param#good">link4</a>
		<!-- these links are bad as they point to a nonexistent element -->
		<a href="#${nextFailId()}">link5</a>
		<a href="https://example.com/#${nextFailId()}">link6</a>
		<a href="https://example.com#${nextFailId()}">link7</a>
	</body>
</html>
			`
		}])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "HASH_TARGET_NOT_FOUND" && error.location.location.type === "html" && error.location.location.element.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
		});
	});

	it("cross document", async () => {
		const {nextFailId, getFailIds} = initFailIds();
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
		<!-- these links is good, as there is an element with that id -->
		<a href="2.html#good">link2</a>
		<a href="https://example.com/2.html#good">link3</a>
		<!-- these links are bad as they point to a nonexistent element -->
		<a href="2.html#${nextFailId()}">link5</a>
		<a href="https://example.com/2.html#${nextFailId()}">link6</a>
	</body>
</html>
			`},
			{
				filename: "2.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<h2 id="good">heading</h2>
	</body>
</html>
			`},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "HASH_TARGET_NOT_FOUND" && error.location.location.type === "html" && error.location.location.element.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
		});
	});

	it("across folders", async () => {
		const {nextFailId, getFailIds} = initFailIds();
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
		<h2 id="main_index_good">heading</h2>
		<!-- these links is good, as there is an element with that id -->
		<a href="folder/2.html#other_good">link2</a>
		<a href="folder/#index_good">link2</a>
		<a href="https://example.com/folder/#index_good">link3</a>
		<a href="https://example.com/folder/index.html#index_good">link3</a>
		<a href="https://example.com/folder/2.html#other_good">link3</a>
		<!-- these links are bad as they point to a nonexistent element -->
		<a href="folder/#${nextFailId()}">link5</a>
		<a href="https://example.com/folder/#${nextFailId()}">link6</a>
		<a href="https://example.com/folder/2.html#${nextFailId()}">link6</a>
	</body>
</html>
			`},
			{
				filename: "folder/index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<h2 id="index_good">heading</h2>
		<!-- works for relative path -->
		<a href="#index_good">link2</a>
		<a href="2.html#other_good">link2</a>
		<!-- works for absolute path -->
		<a href="https://example.com/folder/#index_good">link2</a>
		<a href="https://example.com/folder/index.html#index_good">link2</a>
		<a href="https://example.com/folder/2.html#other_good">link2</a>
		<!-- fails for non-existent relative paths -->
		<a href="#${nextFailId()}">link2</a>
		<a href="2.html#${nextFailId()}">link2</a>
		<!-- fails for non-existent absolute paths -->
		<a href="https://example.com/folder/#${nextFailId()}">link2</a>
		<a href="https://example.com/folder/index.html#${nextFailId()}">link2</a>
		<a href="https://example.com/folder/2.html#${nextFailId()}">link2</a>
		<!-- can traverse up a directory -->
		<a href="../#main_index_good">link2</a>
		<a href="../#${nextFailId()}">link2</a>
	</body>
</html>
			`},
			{
				filename: "folder/2.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<h2 id="other_good">heading</h2>
	</body>
</html>
			`},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length, JSON.stringify(errors, undefined, 4));
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "HASH_TARGET_NOT_FOUND" && error.location.location.type === "html" && error.location.location.element.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
		});
	});

	it("missing target", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const errors = await setupTestFiles([{
			filename: "index.html",
			contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<a href="https://example.com/abc.html">${nextFailId()}</a>
	</body>
</html>
			`
		}])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.location.type === "html" && error.location.location.element.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
		});
	});
	it("in font-face urls", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		// from https://github.com/kenwheeler/slick/blob/e014f8878fb4b21cd367cc5c22a3107cea461278/slick/fonts/slick.woff2
		const woffContents = await fs.readFile(path.resolve(__dirname, "slick.woff2"));
		const errors = await setupTestFiles([
			{
				filename: "index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
		<link rel="stylesheet" type="text/css" href="style.css">
	</head>
	<body>
	</body>
</html>
			`
		},
			{
				filename: "style.css",
				contents: `
@font-face {
	font-family: "Font Awesome 6 Brands";
	font-style: normal;
	font-weight: 400;
	font-display: block;
	src: url("/abc.woff2") format("woff2"), url("${nextFailId()}") format("woff2"), url(/abc.woff2) format("woff2"), url(${nextFailId()}) format("woff2");
}
			`
		},
		{
			filename: "abc.woff2",
			contents: woffContents,
		},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length, JSON.stringify(errors, undefined, 4));
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.location.type === "css" && error.location.location.target.includes(failId)), `Should have an error but did not: ${index}`);
		});
	});
	it.only("in json/ld documents", async () => {
		const {nextFailId, getFailIds} = initFailIds();
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
	<script type="application/ld+json">{
  "@context": "https://schema.org/",
  "@type": "Course",
	"url": "https://example.com/good.html",
	"sameAs": "https://example.com/${nextFailId()}.html",
	"mainEntityOfPage": "https://example2.com/another_domain.html"
}</script>
	</body>
</html>
			`
		},
		{
			filename: "good.html",
			contents: `
<!DOCTYPE html>
<html lang="en-us">
<head>
<title>title</title>
</head>
<body>
</body>
</html>
		`
		},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length, JSON.stringify(errors, undefined, 4));
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.location.type === "html" && error.location.location.element.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
		});
	});
});

describe("extra links", () => {
	describe("txt sitemaps", () => {
		it("works", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const txtSitemap1 = `
https://example.com/${nextFailId()}.html
https://example.com/${nextFailId()}.html
			`;
			const txtSitemap2 = `
https://example.com/${nextFailId()}.html
			`;
			const errors = await setupTestFiles([{
				filename: "index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
	</body>
</html>
				`
			}])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {extraTxtSitemaps: [txtSitemap1, txtSitemap2]}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.location.type === "sitemaptxt" && error.location.url.includes(failId)), `Should have an error but did not: ${index}`);
			});
		});
		it("must contain only links to documents", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const txtSitemap = `
https://example.com/${failId}.css
			`;
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
	</body>
</html>
				`
				},
				{
					filename: `${failId}.css`,
					contents: `
body {
	background-color: red;
}
				`
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {extraTxtSitemaps: [txtSitemap]}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(errors.some((error) => error.type === "LINK_POINTS_TO_NON_DOCUMENT" && error.location.location.type === "sitemaptxt" && error.location.url.includes(failId)), `Should have an error but did not: ${index}`);
			});
		});
	});
	describe("xml sitemaps", () => {
		it("allows xml sitemaps", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const xmlSitemap1 = `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
	<url>
		<loc>https://example.com/${nextFailId()}.html</loc>
	</url>
	<url>
		<loc>https://example.com/${nextFailId()}.html</loc>
	</url>
</urlset>
			`;
			const xmlSitemap2 = `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
	<url>
		<loc>https://example.com/${nextFailId()}.html</loc>
	</url>
</urlset>
			`;
			const errors = await setupTestFiles([{
				filename: "index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
	</body>
</html>
				`
			}])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {extraXmlSitemaps: [xmlSitemap1, xmlSitemap2]}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.location.type === "sitemapxml" && error.location.url.includes(failId)), `Should have an error but did not: ${index}`);
			});
		});
		it("must contain only links to documents", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const xmlSitemap = `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
	<url>
		<loc>https://example.com/${failId}.css</loc>
	</url>
</urlset>
			`;
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
	</body>
</html>
				`
				},
				{
					filename: `${failId}.css`,
					contents: `
body {
	background-color: red;
}
				`
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {extraXmlSitemaps: [xmlSitemap]}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(errors.some((error) => error.type === "LINK_POINTS_TO_NON_DOCUMENT" && error.location.location.type === "sitemapxml" && error.location.url.includes(failId)), `Should have an error but did not: ${index}`);
			});
		});
	})
	describe("url list", () => {
		it("allows url list", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const urlList = [
				`https://example.com/${nextFailId()}.html`,
				`https://example.com/${nextFailId()}.html`,
			];
			const errors = await setupTestFiles([{
				filename: "index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
	</body>
</html>
				`
			}])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {extraUrls: urlList}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length, JSON.stringify(errors, undefined, 4));
			failIds.forEach((failId, index) => {
				assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.location.type === "extraurl" && error.location.url.includes(failId)), `Should have an error but did not: ${index}`);
			});
		});
		it("can contain non-document links", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const urlList = [
				`https://example.com/test.css`,
			];
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
	</body>
</html>
					`
				},
				{
					filename: `test.css`,
					contents: `
body {
	background-color: red;
}
					`
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {extraUrls: urlList}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length);
		});
	});
});

