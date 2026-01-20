import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../src/index.ts";
import {baseIndexFile, initFailIds, setupTestFiles} from "./testutils.ts";

describe("robots.txt", () => {
	describe("host", () => {
		it("can be missing", async () => {
			const errors = await setupTestFiles([
				baseIndexFile,
				{
					filename: "robots.txt",
					contents: `
User-agent: GPTBot
Disallow: /
				`
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir})([{url: "/", role: {type: "document"}}, {url: "/robots.txt", role: {type: "robotstxt"}}], {}, []));
			assert.equal(errors.length, 0);
		});
		it("can be the baseurl", async () => {
			const errors = await setupTestFiles([
				baseIndexFile,
				{
					filename: "robots.txt",
					contents: `
User-agent: GPTBot
Disallow: /

Host: example.com
				`
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir})([{url: "/", role: {type: "document"}}, {url: "/robots.txt", role: {type: "robotstxt"}}], {}, []));
			assert.equal(errors.length, 0);
		});
		it("can not be anything but the baseurl", async () => {
			const errors = await setupTestFiles([
				baseIndexFile,
				{
					filename: "robots.txt",
					contents: `
User-agent: GPTBot
Disallow: /

Host: example2.com
				`
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir})([{url: "/", role: {type: "document"}}, {url: "/robots.txt", role: {type: "robotstxt"}}], {}, []));
			assert.equal(errors.length, 1);
			assert(errors[0].type === "ROBOTS_TXT_HOST_INVALID");
			assert(errors[0].expectedHost === "example.com");
			assert(errors[0].actualHost === "example2.com");
		});
	});
	describe("sitemap", () => {
		it("must be internal", async () => {
			const errors = await setupTestFiles([
				baseIndexFile,
				{
					filename: "robots.txt",
					contents: `
User-agent: GPTBot
Disallow: /

Sitemap: https://example2.com/sitemap.txt
Sitemap: https://example.com/sitemap.txt
				`
				},
				{
					filename: "sitemap.txt",
					contents: `
https://example.com
				`
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir})([{url: "/", role: {type: "document"}}, {url: "/robots.txt", role: {type: "robotstxt"}}], {}, []));
			assert.equal(errors.length, 1);
			assert(errors[0].type === "ROBOTS_TXT_SITEMAP_INVALID");
			assert(errors[0].sitemapUrl === "https://example2.com/sitemap.txt");
		});
	});
});
