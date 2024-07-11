import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {initFailIds, setupTestFiles} from "./testutils.js";

describe("canonical link", () => {
	it("there can only be one canonical link on a page", async () => {
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
		<link rel="canonical" href="${failId}.html">
		<link rel="canonical" href="${failId}.html">
	</head>
	<body>
	</body>
</html>
				`
			},
			{
				filename: `${failId}.html`,
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
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		assert(errors[0].type === "MULTIPLE_CANONICAL_LINKS");
		assert.equal(errors[0].canonicalLinks.length, 2);
		assert(errors[0].canonicalLinks[0].outerHTML.includes(failId));
		assert(errors[0].canonicalLinks[1].outerHTML.includes(failId));
	});
	it("a redirect's canonical can only be the target of the redirect", async () => {
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
		<meta http-equiv="refresh" content="0; url=https://example.com/refresh-target.html">
		<link rel="canonical" href="https://example.com/${failId}.html">
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
			{
				filename: `${failId}.html`,
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
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		assert(errors[0].type === "REDIRECT_DIFFERENT_CANONICAL");
		assert(errors[0].canonicalTarget.includes(failId));
		assert(errors[0].redirectTarget.includes("/refresh-target.html"));
	});
	it("a redirect's canonical can be external", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const errors = await setupTestFiles([
			{
				filename: "index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
		<meta http-equiv="refresh" content="0; url=https://example2.com/refresh-target/">
		<link rel="canonical" href="https://example2.com/refresh-target/">
	</head>
	<body>
	</body>
</html>
				`
			},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
	});
	it("a page's canonical link can only be itself", async () => {
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
	</head>
	<body>
		<a href="good.html">good</a>
		<a href="/good/">good</a>
		<a href="bad.html">bad</a>
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
		<link rel="canonical" href="good.html">
	</head>
	<body>
	</body>
</html>

				`
			},
			{
				filename: "good/index.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
		<link rel="canonical" href="/good/index.html">
	</head>
	<body>
	</body>
</html>

				`
			},
			{
				filename: "bad.html",
				contents: `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
		<link rel="canonical" href="${failId}.html">
	</head>
	<body>
	</body>
</html>

				`
			},
			{
				filename: `${failId}.html`,
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
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		assert(errors[0].type === "NON_REDIRECT_DIFFERENT_CANONICAL");
		assert(errors[0].canonicalLink.includes(failId));
		assert(errors[0].location.url.includes("/bad.html"));
	});
})

