import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {initFailIds, setupTestFiles} from "./testutils.js";

describe("documents", () => {
	describe("json/ld", () => {
		it("reports if it can not be parsed", async () => {
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
		<script type="application/ld+json">{
			"@context": "http://schema.org",
			"@type": "WebSite",
			"name": "${nextFailId()}"",
			"url": "example.com",
			}</script>
	</body>
</html>
				`
			}])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
			const failIds = getFailIds();
			assert.equal(errors.length, failIds.length);
			failIds.forEach((failId, index) => {
				assert(errors.some((error) => error.type === "JSON_LD_UNPARSEABLE" && error.location.location.outerHTML.includes(failId)), `Should have an error but did not: ${index}`);
			});
		});
	})
});
