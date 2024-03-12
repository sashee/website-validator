import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {initFailIds, setupTestFiles} from "./testutils.js";

describe("config", () => {
	describe("indexName", () => {
		it("uses the files for the index if it is defined", async () => {
			const errors = await setupTestFiles([{
				filename: "__index.html",
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
			}])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "__index.html"})([{url: "/", role: {type: "document"}}], {}));
			assert.equal(errors.length, 0);
		});
		it("uses index.html for the index if it is not defined", async () => {
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
			}])((dir) => validate({concurrency: 1})("https://example.com", {dir})([{url: "/", role: {type: "document"}}], {}));
			assert.equal(errors.length, 0);
		});
	})
	describe("contentTypes", () => {
		it("works when validating links", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const errors = await setupTestFiles([
				{
					filename: "index.html",
					contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
		<link href="a.html" type="text/css">
		<link href="${failId}.html" type="text/css">
	</head>
	<body>
	</body>
</html>
					`
				}, {
					filename: "a.html",
					contents: "body {background-color: red;}",
				}, {
					filename: `${failId}.html`,
					contents: "body {background-color: blue;}",
				}
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, contentTypes: (path) => path.includes("a.html") ? "text/css" : "text/html"})([{url: "/", role: {type: "document"}}], {}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(errors.some((error) => error.type === "CONTENT_TYPE_MISMATCH" && error.location.location.type === "html" && error.location.location.element.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
			});
		});
		it("rss and atom can have application/xml content types", async () => {
			const rssContents = `
<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
<title>Advanced Web Machinery</title>
<description>Advanced Web Machinery</description>
<link>https://advancedweb.hu</link>
<lastBuildDate>Fri, 08 Mar 2024 00:00:00 +0000</lastBuildDate>
<pubDate>Fri, 08 Mar 2024 00:00:00 +0000</pubDate>
<ttl>1800</ttl>
</channel>
</rss>
			`;
			const atomContents = `
<?xml version="1.0" encoding="UTF-8" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Advanced Web Machinery</title>
<link href="https://advancedweb.hu/atom.xml" rel="self"/>
<link href="https://advancedweb.hu"/>
<updated>2024-03-08T00:00:00+00:00</updated>
<id>https://advancedweb.hu</id>
<author>
<name>Advanced Web Machinery</name>
<email/>
</author>
</feed>
			`
			const {nextFailId, getFailIds} = initFailIds();
			const failId1 = nextFailId();
			const failId2 = nextFailId();
			const errors = await setupTestFiles([
				{
					filename: "index.html",
					contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
		<link href="/rss.xml" rel="alternate" type="application/rss+xml">
		<link href="/rss-xml.xml" rel="alternate" type="application/rss+xml">
		<link href="/rss-${failId1}.xml" rel="alternate" type="application/rss+xml">
		<link href="/atom.xml" rel="alternate" type="application/atom+xml">
		<link href="/atom-xml.xml" rel="alternate" type="application/atom+xml">
		<link href="/atom-${failId2}.xml" rel="alternate" type="application/atom+xml">
	</head>
	<body>
	</body>
</html>
					`
				}, {
					filename: "rss.xml",
					contents: rssContents,
				}, {
					filename: `rss-xml.xml`,
					contents: rssContents,
				}, {
					filename: `rss-${failId1}.xml`,
					contents: rssContents,
				}, {
					filename: "atom.xml",
					contents: atomContents,
				}, {
					filename: `atom-xml.xml`,
					contents: atomContents,
				}, {
					filename: `atom-${failId2}.xml`,
					contents: atomContents,
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, contentTypes: (path) => {
				if (path.includes("rss.xml")) {
					return "application/rss+xml";
				}else if (path.includes("atom.xml")) {
					return "application/atom+xml";
				}else if (path.includes("rss-xml.xml") || path.includes("atom-xml.xml")) {
					return "application/xml";
				}else if (path.includes(failId1) || path.includes(failId2)) {
					return "text/html";
				}else {
					return "text/html";
				}
			}})([{url: "/", role: {type: "document"}}], {}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(errors.some((error) => error.type === "CONTENT_TYPE_MISMATCH" && error.location.location.type === "html" && error.location.location.element.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
			});
		})
	});
});
