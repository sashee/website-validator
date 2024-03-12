import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {setupTestFiles} from "./testutils.js";

describe("NOT_FOUND", () => {
	it("reports if a fetch base is missing", async () => {
			const errors = await setupTestFiles([])((dir) => validate({concurrency: 1})("https://example.com", {dir})([{url: "/", role: {type: "document"}}], {}));
			assert.equal(errors.length, 1);
			assert(errors[0].type === "NOT_FOUND");
			assert(errors[0].location.url === "/");
			assert(errors[0].location.location.type === "fetchBase");
			assert(errors[0].location.location.index === 0);
	});
});
