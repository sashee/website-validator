import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {setupTestFiles} from "./testutils.js";

describe("json", () => {
	it("reports no errors for a valid json file", async () => {
		const json = JSON.stringify({a: ["bb", 34, {obj: "aa"}]});
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
		<a href="test.json">json file</a>
	</body>
</html>
			`
			},
			{
				filename: "test.json",
				contents: json,
			}
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		assert.equal(errors.length, 0);
	});
	it("reports errors for an invalid json file", async () => {
		const json = `{"a": [}`;
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
		<a href="test.json">json file</a>
	</body>
</html>
			`
			},
			{
				filename: "test.json",
				contents: json,
			}
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		assert.equal(errors.length, 1);
		assert(errors[0].type === "JSON_FILE_UNPARSEABLE" && errors[0].location.url.includes("test.json"), `Should have an error but did not`);
	});
});
