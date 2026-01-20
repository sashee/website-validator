import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {compareVersions} from "../src/index.ts";
import {initFailIds, setupTestFiles} from "./testutils.ts";
import util from "node:util";

describe("compare", () => {
	it("reports when a file is removed from the sitemap", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const fetchBases = [{url: "/sitemap.txt", role: {type: "sitemap"}}] as const;
		const {removedPermanentUrls} = await setupTestFiles([{
			filename: "sitemap.txt",
			contents: `
https://example.com/a.html
https://example.com/${nextFailId()}.html
			`
		}])((originalDir) => {
			return setupTestFiles([
				{
					filename: "sitemap.txt",
					contents: `
	https://example.com/a.html
					`
				},
				{
					filename: "a.html",
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
			])((newDir) => {
				return compareVersions({concurrency: 1})
					("https://example.com", {dir: newDir})
					(fetchBases, {})
					("https://example.com", {dir: originalDir})
					(fetchBases, {});
			})
		});
		const failIds = getFailIds();
		assert.equal(removedPermanentUrls.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(removedPermanentUrls.some((location) => location.url.includes(failId) && location.location.type === "sitemaptxt"), `Should have an error but did not: ${index}`);
		});
	});
	it("reports when a link is now non-permanent", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const fetchBases = [{url: "/sitemap.txt", role: {type: "sitemap"}}] as const;
		const {removedPermanentUrls} = await setupTestFiles([
			{
				filename: "sitemap.txt",
				contents: `
	https://example.com/a.html
	https://example.com/${failId}.html
				`
			},
			{
				filename: "a.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<a href="https://example.com/${failId}.html">link</a>
	</body>
</html>
				`
			},
		])((originalDir) => {
			return setupTestFiles([
				{
					filename: "sitemap.txt",
					contents: `
	https://example.com/a.html
					`
				},
				{
					filename: "a.html",
					contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		<a href="https://example.com/${failId}.html">link</a>
	</body>
</html>
					`
				},
			])((newDir) => {
				return compareVersions({concurrency: 1})
					("https://example.com", {dir: newDir})
					(fetchBases, {})
					("https://example.com", {dir: originalDir})
					(fetchBases, {});
			})
		});
		const failIds = getFailIds();
		assert.equal(removedPermanentUrls.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(removedPermanentUrls.some((location) => location.url.includes(failId) && location.location.type === "sitemaptxt"), `Should have an error but did not: ${index}`);
		});
	});
	// TODO: test: reports when a permanent link with role: document is no longer a document
	it("reports when a file is removed from a json file", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const fetchBases = [{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "urls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}] as const;
		const {removedPermanentUrls} = await setupTestFiles([{
			filename: "a.json",
			contents: JSON.stringify({urls: ["https://example.com/a.html", `https://example.com/${failId}.html`]}),
		}])((originalDir) => {
			return setupTestFiles([{
				filename: "a.json",
				contents: JSON.stringify({urls: ["https://example.com/a.html"]}),
			}])((newDir) => {
				return compareVersions({concurrency: 1})
					("https://example.com", {dir: newDir})
					(fetchBases, {})
					("https://example.com", {dir: originalDir})
					(fetchBases, {});
			})
		});
		const failIds = getFailIds();
		assert.equal(removedPermanentUrls.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(removedPermanentUrls.some((location) => location.url.includes(failId) && location.location.type === "json"), `Should have an error but did not: ${index}`);
		});
	});
	it("reports when the structure of the json file is changed and some links are not found", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const {removedPermanentUrls} = await setupTestFiles([{
			filename: "a.json",
			contents: JSON.stringify({urls: [`https://example.com/${failId}.html`]}),
		}])((originalDir) => {
			return setupTestFiles([{
				filename: "a.json",
				contents: JSON.stringify({newUrls: [`https://example.com/${failId}.html`]}),
			}])((newDir) => {
				return compareVersions({concurrency: 1})
					("https://example.com", {dir: newDir})
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "urls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {})
					("https://example.com", {dir: originalDir})
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "urls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {});
			})
		});
		const failIds = getFailIds();
		assert.equal(removedPermanentUrls.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(removedPermanentUrls.some((location) => location.url.includes(failId) && location.location.type === "json"), `Should have an error but did not: ${index}`);
		});
	});
	it("reports non forward-compatible link in json files", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const {nonForwardCompatibleJsonLinks} = await setupTestFiles([{
			filename: "a.json",
			contents: JSON.stringify({urls: [`https://example.com/${failId}.html`]}),
		}])((originalDir) => {
			return setupTestFiles([{
				filename: "a.json",
				contents: JSON.stringify({newUrls: [`https://example.com/${failId}.html`]}),
			}])((newDir) => {
				return compareVersions({concurrency: 1})
					("https://example.com", {dir: newDir})
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "newUrls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {})
					("https://example.com", {dir: originalDir})
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "urls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {});
			})
		});
		const failIds = getFailIds();
		assert.equal(nonForwardCompatibleJsonLinks.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(nonForwardCompatibleJsonLinks.some((location) => location.url.includes(failId) && location.location.type === "json"), `Should have an error but did not: ${index}`);
		});
	});
	it("detects links in jsons as forward-compatible when they are present with the original config as well", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const {nonForwardCompatibleJsonLinks} = await setupTestFiles([{
			filename: "a.json",
			contents: JSON.stringify({urls: [`https://example.com/a.html`]}),
		}])((originalDir) => {
			return setupTestFiles([{
				filename: "a.json",
				contents: JSON.stringify({newUrls: [`https://example.com/a.html`]}),
			}])((newDir) => {
				return compareVersions({concurrency: 1})
					("https://example.com", {dir: newDir})
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "newUrls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {})
					("https://example.com", {dir: originalDir})
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "urls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}, {jmespath: "newUrls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {});
			})
		});
		const failIds = getFailIds();
		assert.equal(nonForwardCompatibleJsonLinks.length, failIds.length);
	});
	describe("rss", () => {
		it("reports when an rss item's guid is changed for the same url", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const fetchBases = [{url: "/rss.xml", role: {type: "rss"}}] as const;
			const failId = nextFailId();
			const {feedGuidsChanged} = await setupTestFiles([{
				filename: "rss.xml",
				contents: `
<rss version="2.0">
<channel>
	<title>Advanced Web Machinery</title>
	<description>Advanced Web Machinery</description>
	<link>https://advancedweb.hu</link>
	<lastBuildDate>Tue, 06 Feb 2024 00:00:00 +0000</lastBuildDate>
	<pubDate>Tue, 06 Feb 2024 00:00:00 +0000</pubDate>
	<ttl>1800</ttl>
	<item>
		<title>Using worker pools in NodeJs</title>
		<link>${failId}</link>
		<guid isPermalink="false">https://advancedweb.hu/using-worker-pools-in-nodejs</guid>
		<pubDate>Tue, 06 Feb 2024 00:00:00 +0000</pubDate>
		<description>abc</description>
	</item>
	<item>
		<title>second</title>
		<link>https://example.com/abc</link>
		<guid isPermalink="false">second</guid>
		<pubDate>Tue, 06 Feb 2024 00:00:00 +0000</pubDate>
		<description>abc</description>
	</item>
	</channel>
</rss>
				`
			}])((originalDir) => {
				return setupTestFiles([
					{
						filename: "rss.xml",
						contents: `
<rss version="2.0">
<channel>
	<title>Advanced Web Machinery</title>
	<description>Advanced Web Machinery</description>
	<link>https://advancedweb.hu</link>
	<lastBuildDate>Tue, 06 Feb 2024 00:00:00 +0000</lastBuildDate>
	<pubDate>Tue, 06 Feb 2024 00:00:00 +0000</pubDate>
	<ttl>1800</ttl>
	<item>
		<title>Using worker pools in NodeJs</title>
		<link>${failId}</link>
		<guid isPermalink="false">changed</guid>
		<pubDate>Tue, 06 Feb 2024 00:00:00 +0000</pubDate>
		<description>abc</description>
	</item>
	<item>
		<title>second</title>
		<link>https://example.com/abc</link>
		<guid isPermalink="false">second</guid>
		<pubDate>Tue, 06 Feb 2024 00:00:00 +0000</pubDate>
		<description>abc</description>
	</item>
	</channel>
</rss>
						`
					},
				])((newDir) => {
					return compareVersions({concurrency: 1})
						("https://example.com", {dir: newDir})
						(fetchBases, {})
						("https://example.com", {dir: originalDir})
						(fetchBases, {});
				})
			});
			const failIds = getFailIds();
			assert.equal(feedGuidsChanged.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(feedGuidsChanged.some((location) => location.url.includes(failId) && location.feedUrl.includes("rss.xml")), `Should have an error but did not: ${index}`);
			});
		});
	})
	describe("atom", () => {
		it("reports when a atom item's id is changed for the same url", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const fetchBases = [{url: "/atom.xml", role: {type: "atom"}}] as const;
			const failId = nextFailId();
			const {feedGuidsChanged} = await setupTestFiles([{
				filename: "atom.xml",
				contents: `
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>Advanced Web Machinery</title>
	<link href="https://advancedweb.hu/atom.xml" rel="self"/>
	<link href="https://advancedweb.hu"/>
	<updated>2024-02-06T00:00:00+00:00</updated>
	<id>https://advancedweb.hu</id>
	<author>
		<name>Advanced Web Machinery</name>
		<email/>
	</author>
	<entry>
		<title>Using worker pools in NodeJs</title>
		<link href="${failId}"/>
		<updated>2024-02-06T00:00:00+00:00</updated>
		<id>https://advancedweb.hu/using-worker-pools-in-nodejs</id>
		<content type="html">abc</content>
	</entry>
	<entry>
		<title>second</title>
		<link href="https://example.com/abc"/>
		<updated>2024-02-06T00:00:00+00:00</updated>
		<id>second</id>
		<content type="html">abc</content>
	</entry>
</feed>
				`
			}])((originalDir) => {
				return setupTestFiles([
					{
						filename: "atom.xml",
						contents: `
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>Advanced Web Machinery</title>
	<link href="https://advancedweb.hu/atom.xml" rel="self"/>
	<link href="https://advancedweb.hu"/>
	<updated>2024-02-06T00:00:00+00:00</updated>
	<id>https://advancedweb.hu</id>
	<author>
		<name>Advanced Web Machinery</name>
		<email/>
	</author>
	<entry>
		<title>Using worker pools in NodeJs</title>
		<link href="${failId}"/>
		<updated>2024-02-06T00:00:00+00:00</updated>
		<id>changed</id>
		<content type="html">abc</content>
	</entry>
	<entry>
		<title>second</title>
		<link href="https://example.com/abc"/>
		<updated>2024-02-06T00:00:00+00:00</updated>
		<id>second</id>
		<content type="html">abc</content>
	</entry>
</feed>
						`
					},
				])((newDir) => {
					return compareVersions({concurrency: 1})
						("https://example.com", {dir: newDir})
						(fetchBases, {})
						("https://example.com", {dir: originalDir})
						(fetchBases, {});
				})
			});
			const failIds = getFailIds();
			assert.equal(feedGuidsChanged.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(feedGuidsChanged.some((location) => location.url.includes(failId) && location.feedUrl.includes("atom.xml")), `Should have an error but did not: ${index}`);
			});
		});
	})
});

