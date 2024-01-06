import {describe, it} from "node:test";
import path from "node:path";
import url from "node:url";
import { strict as assert } from "node:assert";
import {validate} from "../../index.js";
import {withTempDir} from "../../utils.js";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const setupTestFiles = (files: {filename: string, contents: string}[]) => async <T> (fn: (dir: string) => T) => {
	return withTempDir(async (dir) => {
		await Promise.all(files.map(async ({filename, contents}) => {
			const name = path.join(dir, filename);

			await fs.mkdir(path.dirname(name), {recursive: true});
			await fs.writeFile(name, contents)
		}));
		return fn(dir);
	});
}

const initFailIds = () => {
	const ids = [] as string[];
	return {
		nextFailId: () => {
			const nextId = crypto.randomUUID();
			ids.push(nextId);
			return nextId;
		},
		getFailIds: () => ids,
	}
};

describe("links", () => {
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
		<!-- these links are bad as they point to a nonexistent element -->
		<a href="#${nextFailId()}">link5</a>
		<a href="https://example.com/#${nextFailId()}">link6</a>
		<a href="https://example.com#${nextFailId()}">link7</a>
	</body>
</html>
			`
		}])((dir) => validate(dir, "https://example.com", "index.html")([{url: "/", role: {type: "document"}}]));
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
		])((dir) => validate(dir, "https://example.com", "index.html")([{url: "/", role: {type: "document"}}]));
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
		])((dir) => validate(dir, "https://example.com", "index.html")([{url: "/", role: {type: "document"}}]));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
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
		}])((dir) => validate(dir, "https://example.com", "index.html")([{url: "/", role: {type: "document"}}]));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.location.type === "html" && error.location.location.element.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
		});
	});
});

it.skip("html error", async () => {
 try{
	 /*
	const res = await validate(path.join(__dirname, "static"), "https://example.com")([{url: "/", role: {type: "document"}}]);
	*/
	const res = await validate(path.join(__dirname, "..", "..", "..", "..", "awm", "blog", "_site"), "https://advancedweb.hu")([
		{url: "/", role: {type: "document"}},
		{url: "/robots.txt", role: {type: "robotstxt"}},
		{url: "/rss-sashee.xml", role: {type: "rss"}},
		{url: "/promos.json", role: {type: "json", extractConfigs: [{jmespath: "promos[*].url", asserts: [], role: {type: "document"}}, {jmespath: "promos[*].image", asserts: [{type: "image"}, {type: "permanent"}], role: {type: "asset"}}]}},
		{url: "/flashback.json", role: {type: "json", extractConfigs: [{jmespath: "[*].[image, \"small-image\"][]", asserts: [{type: "image"}, {type: "permanent"}], role: {type: "asset"}}, {jmespath: "[*].url", asserts: [{type: "permanent"}], role: {type: "document"}}]}},
	]);
	console.log(JSON.stringify(res, undefined, 4));
 }catch(e) {
	 console.error(e);
	 throw e;
 }
});

