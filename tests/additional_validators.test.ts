import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../src/index.ts";
import {setupTestFiles, initFailIds} from "./testutils.ts";

const htmlWithJsonLds = (jsonLds: string[]) => {
	return `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
		${jsonLds.map((jsonLd) => `
			<script type="application/ld+json">
				${jsonLd}
			</script>
		`)}
	</body>
</html>
`;
}

describe("urlPattern", () => {
	const test = async (additionalValidators: Parameters<ReturnType<ReturnType<typeof validate>>>[2]) => {
		return setupTestFiles([
			{
				filename: "bad.json",
				contents: JSON.stringify({a: "test"}),
			},
			{
				filename: "good.json",
				contents: JSON.stringify({a: 15}),
			},
			{
				filename: "__index__.html",
				contents: htmlWithJsonLds([JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting", name: "abc"})]),
			},
			{
				filename: "index.html",
				contents: htmlWithJsonLds([JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting"})]),
			},
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/good.json", role: {type: "json", extractConfigs: []}},{url: "/bad.json", role: {type: "json", extractConfigs: []}}, {url: "/__index__.html", role: {type: "document"}},{ url: "/index.html", role: {type: "document"}}], {}, additionalValidators));
	}
	it("works", async () => {
		const additionalValidators = (urlPattern: RegExp) => {
			return [{
				urlPattern,
				config: {
					type: "json",
					schema: {
						type: "object",
						properties: {
							a: {type: "number"},
						},
					}
				}
			}] as const;
		}
		{
			const errors = await test(additionalValidators(/^\/good.json$/));
			assert.equal(errors.length, 0, JSON.stringify(errors, undefined, 4));
		}
		{
			const errors = await test(additionalValidators(/^\/bad.json$/));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
		}
	});
	it("gets the relative url with the indexName", async () => {
		const additionalValidators = (urlPattern: RegExp) => {
			return [{
				urlPattern,
				config: {
					type: "json-ld",
					filter: {
						type: "object",
						properties: {
							"@type": {const: "BlogPosting"},
						}
					},
					schema: {
						type: "object",
						properties: {
							name: {type: "string"},
						},
						required: ["name"],
					}
				}
			}] as const;
		};
		{
			const errors = await test(additionalValidators(/^\/__index__.html$/));
			assert.equal(errors.length, 0, JSON.stringify(errors, undefined, 4));
		}
		{
			const errors = await test(additionalValidators(/^\/index.html$/));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
		}
	});
	describe("minMatches", () => {
		it("works", async () => {
			const additionalValidators = (urlPattern: RegExp) => {
				return [{
					urlPattern,
					config: {
						type: "json-ld",
						filter: {
							type: "object",
							properties: {
								"@type": {const: "BlogPosting"},
							}
						},
						minOccurrence: 1,
					},
					minMatches: 1,
				}] as const;
			};
			{
				const errors = await test(additionalValidators(/^\/__index__.html$/));
				assert.equal(errors.length, 0, JSON.stringify(errors, undefined, 4));
			}
			{
				const errors = await test(additionalValidators(/^\/nonexistent.html$/));
				assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
				assert.equal(errors[0].type, "ADDITIONAL_VALIDATOR_MATCH_NUMBER_OUTSIDE_EXPECTED_RANGE", JSON.stringify(errors, undefined, 4));
			}
		});
	});
	describe("maxMatches", () => {
		it("works", async () => {
			const additionalValidators = (urlPattern: RegExp) => {
				return [{
					urlPattern,
					config: {
						type: "json-ld",
						filter: {
							type: "object",
							properties: {
								"@type": {const: "BlogPosting"},
							}
						},
						minOccurrence: 1,
					},
					maxMatches: 1,
				}] as const;
			};
			{
				const errors = await test(additionalValidators(/^\/__index__.html$/));
				assert.equal(errors.length, 0, JSON.stringify(errors, undefined, 4));
			}
			{
				const errors = await test(additionalValidators(/\.html/));
				assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
				assert.equal(errors[0].type, "ADDITIONAL_VALIDATOR_MATCH_NUMBER_OUTSIDE_EXPECTED_RANGE", JSON.stringify(errors, undefined, 4));
			}
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

describe("json/ld", () => {
	describe("minOccurrence", () => {
		it("works when the validation passes", async () => {
			const additionalValidators = [{
				urlPattern: /test.html/,
				config: {
					type: "json-ld",
					filter: {
						type: "object",
						properties: {
							"@type": {const: "BlogPosting"},
						}
					},
					minOccurrence: 1,
				}
			}] as const;
			const errors = await setupTestFiles([
				{
					filename: "test.html",
					contents: htmlWithJsonLds([JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting"})]),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/test.html", role: {type: "document"}}], {}, additionalValidators));
			assert.equal(errors.length, 0, JSON.stringify(errors, undefined, 4));
		});
		it("works when the validation fails", async () => {
			const additionalValidators = [{
				urlPattern: /test.html/,
				config: {
					type: "json-ld",
					filter: {
						type: "object",
						properties: {
							"@type": {const: "BlogPosting"},
						}
					},
					minOccurrence: 2,
				}
			}] as const;
			const errors = await setupTestFiles([
				{
					filename: "test.html",
					contents: htmlWithJsonLds([JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting"})]),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/test.html", role: {type: "document"}}], {}, additionalValidators));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
			assert.equal(errors[0].type, "JSON_LD_DOES_NOT_MATCH_OCCURRENCE_REQUIREMENT", JSON.stringify(errors, undefined, 4));
		});
	});
	describe("maxOccurrence", () => {
		it("works when the validation passes", async () => {
			const additionalValidators = [{
				urlPattern: /test.html/,
				config: {
					type: "json-ld",
					filter: {
						type: "object",
						properties: {
							"@type": {const: "BlogPosting"},
						}
					},
					maxOccurrence: 2,
				}
			}] as const;
			const errors = await setupTestFiles([
				{
					filename: "test.html",
					contents: htmlWithJsonLds([JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting"}), JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting"})]),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/test.html", role: {type: "document"}}], {}, additionalValidators));
			assert.equal(errors.length, 0, JSON.stringify(errors, undefined, 4));
		});
		it("works when the validation fails", async () => {
			const additionalValidators = [{
				urlPattern: /test.html/,
				config: {
					type: "json-ld",
					filter: {
						type: "object",
						properties: {
							"@type": {const: "BlogPosting"},
						}
					},
					maxOccurrence: 1,
				}
			}] as const;
			const errors = await setupTestFiles([
				{
					filename: "test.html",
					contents: htmlWithJsonLds([JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting"}), JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting"})]),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/test.html", role: {type: "document"}}], {}, additionalValidators));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
			assert.equal(errors[0].type, "JSON_LD_DOES_NOT_MATCH_OCCURRENCE_REQUIREMENT", JSON.stringify(errors, undefined, 4));
		});
	});
	describe("schema", () => {
		it("works when the validation passes", async () => {
			const additionalValidators = [{
				urlPattern: /test.html/,
				config: {
					type: "json-ld",
					filter: {
						type: "object",
						properties: {
							"@type": {const: "BlogPosting"},
						}
					},
					schema: {
						type: "object",
						properties: {
							name: {type: "string"},
						},
						required: ["name"],
					}
				}
			}] as const;
			const errors = await setupTestFiles([
				{
					filename: "test.html",
					contents: htmlWithJsonLds([JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting", name: "test"})]),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/test.html", role: {type: "document"}}], {}, additionalValidators));
			assert.equal(errors.length, 0, JSON.stringify(errors, undefined, 4));
		});
		it("works when the validation fails", async () => {
			const additionalValidators = [{
				urlPattern: /test.html/,
				config: {
					type: "json-ld",
					filter: {
						type: "object",
						properties: {
							"@type": {const: "BlogPosting"},
						}
					},
					schema: {
						type: "object",
						properties: {
							name: {type: "string"},
						},
						required: ["name"],
					}
				}
			}] as const;
			const errors = await setupTestFiles([
				{
					filename: "test.html",
					contents: htmlWithJsonLds([JSON.stringify({"@context": "https://schema.org/", "@type": "BlogPosting", description: "test"})]),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/test.html", role: {type: "document"}}], {}, additionalValidators));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
			assert.equal(errors[0].type, "JSON_LD_DOES_NOT_MATCH_SCHEMA", JSON.stringify(errors, undefined, 4));
		});
	});
});
