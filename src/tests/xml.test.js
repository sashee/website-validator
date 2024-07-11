import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {setupTestFiles} from "./testutils.js";
import muhammara from "muhammara";
import streams from "memory-streams";

describe("xml", () => {
	it("reports no errors for a valid xml file", async () => {
		const xml = "<foo></foo>";
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
		<a href="test.xml">xml file</a>
	</body>
</html>
			`
			},
			{
				filename: "test.xml",
				contents: xml,
			}
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		assert.equal(errors.length, 0);
	});
	it("reports errors for an invalid xml file", async () => {
		const xml = "<foo></foo2>";
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
		<a href="test.xml">xml file</a>
	</body>
</html>
			`
			},
			{
				filename: "test.xml",
				contents: xml,
			}
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}, []));
		assert.equal(errors.length, 1);
		assert(errors[0].type === "XML_FILE_UNPARSEABLE" && errors[0].location.url.includes("test.xml"), `Should have an error but did not`);
	});
});
