import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {compareVersions} from "../index.js";
import {initFailIds, setupTestFiles} from "./testutils.js";
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
				return compareVersions
					(newDir, "https://example.com", "index.html")
					(fetchBases, {})
					(originalDir, "https://example.com", "index.html")
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
				return compareVersions
					(newDir, "https://example.com", "index.html")
					(fetchBases, {})
					(originalDir, "https://example.com", "index.html")
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
				return compareVersions
					(newDir, "https://example.com", "index.html")
					(fetchBases, {})
					(originalDir, "https://example.com", "index.html")
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
				return compareVersions
					(newDir, "https://example.com", "index.html")
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "urls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {})
					(originalDir, "https://example.com", "index.html")
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
				return compareVersions
					(newDir, "https://example.com", "index.html")
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "newUrls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {})
					(originalDir, "https://example.com", "index.html")
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
				return compareVersions
					(newDir, "https://example.com", "index.html")
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "newUrls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {})
					(originalDir, "https://example.com", "index.html")
					([{url: "/a.json", role: {type: "json", extractConfigs: [{jmespath: "urls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}, {jmespath: "newUrls[]", asserts: [{type: "permanent"}], role: {type: "asset"}}]}}], {});
			})
		});
		const failIds = getFailIds();
		assert.equal(nonForwardCompatibleJsonLinks.length, failIds.length);
	});
});

