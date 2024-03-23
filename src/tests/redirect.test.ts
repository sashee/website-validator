import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {initFailIds, setupTestFiles} from "./testutils.js";
import fs from "node:fs/promises";
import url from "url";
import path from "node:path";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

describe("redirects", () => {
	it("follows 301, 302, 307, and 308 status codes", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const errorFiles = (code: number) => {
			return [
				{
					filename: `${code}.html`,
					contents: ``
				},
				{
					filename: `${code}-target.html`,
					contents: `
<!DOCTYPE html>
<html lang="en-us">
<head>
	<title>title</title>
</head>
<body>
<a href="${code}-${nextFailId()}.html">not found</a>
</body>
</html>
					`
				},
			]
		}
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
	<a href="301.html">301</a>
	<a href="302.html">302</a>
	<a href="307.html">307</a>
	<a href="308.html">308</a>
	</body>
</html>
				`
			},
			...errorFiles(301),
			...errorFiles(302),
			...errorFiles(307),
			...errorFiles(308),
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html", responseMeta: (path) => {
			if (path.endsWith("/301.html")) {
				return {
					headers: {Location: "301-target.html"},
					status: 301,
				};
			} else if (path.endsWith("/302.html")) {
				return {
					headers: {Location: "302-target.html"},
					status: 302,
				};
			} else if (path.endsWith("/307.html")) {
				return {
					headers: {Location: "307-target.html"},
					status: 307,
				};
			} else if (path.endsWith("/308.html")) {
				return {
					headers: {Location: "308-target.html"},
					status: 308,
				};
			}else {
				return {
					headers: {"Content-Type": "text/html"},
					status: 200,
				}
			}
		}})([{url: "/", role: {type: "document"}}], {}));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
	});
	it("follows meta refresh", async () => {
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
	<a href="refresh.html">308</a>
	</body>
</html>
				`
			},
			{
				filename: `refresh.html`,
				contents: `
<!DOCTYPE html>
<html lang="en-us">
<head>
	<title>title</title>
	<meta http-equiv="refresh" content="0; url=https://example.com/refresh-target.html">
</head>
<body>
</body>
</html>
				`
			},
			{
				filename: `refresh-target.html`,
				contents: `
<!DOCTYPE html>
<html lang="en-us">
<head>
	<title>title</title>
</head>
<body>
<a href="${nextFailId()}.html">not found</a>
</body>
</html>
				`
			},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
	});
	it("reports when a redirect points to another redirect", async () => {
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
	<a href="refresh.html">308</a>
	</body>
</html>
				`
			},
			{
				filename: `refresh.html`,
				contents: `
<!DOCTYPE html>
<html lang="en-us">
<head>
	<title>title</title>
	<meta http-equiv="refresh" content="0; url=https://example.com/refresh-2.html">
</head>
<body>
</body>
</html>
				`
			},
			{
				filename: `refresh-2.html`,
				contents: `
<!DOCTYPE html>
<html lang="en-us">
<head>
	<title>title</title>
	<meta http-equiv="refresh" content="0; url=https://example.com/refresh-target.html">
</head>
<body>
</body>
</html>
				`
			},
			{
				filename: `refresh-target.html`,
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
		assert.equal(errors.length, 1);
		assert(errors[0].type === "REDIRECT_CHAIN");
		assert(errors[0].targetUrl.endsWith("/refresh-target.html"));
		assert(errors[0].location.url.endsWith("/refresh-2.html"));
	});
})

