import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {baseIndexFile, initFailIds, setupTestFiles, baseHtmlContents} from "./testutils.js";

describe("sitemap", () => {
	describe("xml", () => {
		it("links must be internal", async () => {
			const errors = await setupTestFiles([
				baseIndexFile,
				{
					filename: "sitemap.xml",
					contents: `
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
<url>
<loc>https://example.com/internal.html</loc>
<loc>https://example2.com/external.html</loc>
</url>
</urlset>
				`
				},
				{
					filename: "internal.html",
					contents: baseHtmlContents,
				}
			])((dir) => validate({concurrency: 1})("https://example.com", {dir})([{url: "/", role: {type: "document"}}, {url: "/sitemap.xml", role: {type: "sitemap"}}], {}));
			assert.equal(errors.length, 1);
			assert.equal(errors[0].type, "SITEMAP_LINK_INVALID");
			assert(errors[0].sitemapUrl.includes("sitemap.xml"));
			assert.equal(errors[0].url, "https://example2.com/external.html");
		});
	});
	describe("txt", () => {
		it("links must be internal", async () => {
			const errors = await setupTestFiles([
				baseIndexFile,
				{
					filename: "sitemap.txt",
					contents: `
https://example.com/internal.html
https://example2.com/external.html
				`
				},
				{
					filename: "internal.html",
					contents: baseHtmlContents,
				}
			])((dir) => validate({concurrency: 1})("https://example.com", {dir})([{url: "/", role: {type: "document"}}, {url: "/sitemap.txt", role: {type: "sitemap"}}], {}));
			assert.equal(errors.length, 1);
			assert.equal(errors[0].type, "SITEMAP_LINK_INVALID");
			assert(errors[0].sitemapUrl.includes("sitemap.txt"));
			assert.equal(errors[0].url, "https://example2.com/external.html");
		});
	});
});

