import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {setupTestFiles, initFailIds} from "./testutils.js";

describe("urlPattern", () => {
	it("works", async () => {
		const {getFailIds} = initFailIds();
		const schema = {
			type: "object",
			properties: {
				a: {type: "number"},
			},
		};
		const errors = await setupTestFiles([
			{
				filename: "bad.json",
				contents: JSON.stringify({a: "test"}),
			},
			{
				filename: "good.json",
				contents: JSON.stringify({a: 15}),
			},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/good.json", role: {type: "json", extractConfigs: []}},{ url: "/bad.json", role: {type: "json", extractConfigs: []}}], {}, [{urlPattern: /good.json$/, config: {type: "json", schema}}]));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "JSON_DOES_NOT_MATCH_SCHEMA"), `Should have an error but did not: ${index}`);
		});
	});
});

describe("json", () => {
	it("works when the validation passes", async () => {
		const {getFailIds} = initFailIds();
		const schema = {
			type: "object",
			properties: {
				a: {type: "string"},
			},
		};
		const errors = await setupTestFiles([
			{
				filename: "test.json",
				contents: JSON.stringify({a: "test"}),
			},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/test.json", role: {type: "json", extractConfigs: []}}], {}, [{urlPattern: /test.json$/, config: {type: "json", schema}}]));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "JSON_DOES_NOT_MATCH_SCHEMA"), `Should have an error but did not: ${index}`);
		});
	});
	it("reports errors when the additional json validator fails", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const schema = {
			type: "object",
			properties: {
				a: {type: "number"},
			},
		};
		const errors = await setupTestFiles([
			{
				filename: "test.json",
				contents: JSON.stringify({a: String(nextFailId())}),
			},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/test.json", role: {type: "json", extractConfigs: []}}], {}, [{urlPattern: /test.json$/, config: {type: "json", schema}}]));
		const failIds = getFailIds();
		assert.equal(errors.length, failIds.length);
		failIds.forEach((failId, index) => {
			assert(errors.some((error) => error.type === "JSON_DOES_NOT_MATCH_SCHEMA"), `Should have an error but did not: ${index}`);
		});
	});
});
