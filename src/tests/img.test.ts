import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {setupTestFiles} from "./testutils.js";
import sharp from "sharp";

const generateImage = async (w: number, h: number) => {
	return sharp({
		create: {
			width: w,
			height: h,
			channels: 4,
			background: "white",
		},
	}).png().toBuffer();
}

describe("img", () => {
	describe("srcset and src", () => {
		it("reports if the sizes don't follow the density", async () => {
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
		<img src="image150x150.png" srcset="image200x200.png 2x, image150x150.png 1x" id="bad" alt="img">
		<img src="image100x100.png" srcset="image200x200.png 2x, image150x150.png 1.5x" id="good" alt="img">
	</body>
</html>
				`
				},
				{
					filename: "image200x200.png",
					contents: await generateImage(200, 200),
				},
				{
					filename: "image100x100.png",
					contents: await generateImage(100, 100),
				},
				{
					filename: "image150x150.png",
					contents: await generateImage(150, 150),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
			assert(errors[0].type === "IMG_SRC_INVALID");
			assert(errors[0].location.location.outerHTML.includes("bad"));
			assert(errors[0].srcset);
			assert(errors[0].src);
			assert.equal(errors[0].src.width, 150);
			assert("density" in errors[0].srcset[0].descriptor);
			assert.equal(errors[0].srcset[0].descriptor.density, 2);
			assert.equal(errors[0].srcset[0].width, 200);
			assert.equal(errors[0].srcset[1].width, 150);
		});
		it("reports if the sizes are in different aspect ratio", async () => {
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
		<img src="image100x100.png" srcset="image200x200.png 2x, image150x160.png 1.5x" id="bad" alt="img">
		<img src="image100x100.png" srcset="image200x200.png 2x, image150x150.png 1.5x" id="good" alt="img">
	</body>
</html>
				`
				},
				{
					filename: "image200x200.png",
					contents: await generateImage(200, 200),
				},
				{
					filename: "image150x160.png",
					contents: await generateImage(150, 160),
				},
				{
					filename: "image100x100.png",
					contents: await generateImage(100, 100),
				},
				{
					filename: "image150x150.png",
					contents: await generateImage(150, 150),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
			assert(errors[0].type === "IMG_SRC_INVALID");
			assert(errors[0].location.location.outerHTML.includes("bad"));
			assert(errors[0].srcset);
			assert("density" in errors[0].srcset[0].descriptor);
			assert("density" in errors[0].srcset[1].descriptor);
			assert.equal(errors[0].srcset[0].descriptor.density, 2);
			assert.equal(errors[0].srcset[0].height, 200);
			assert.equal(errors[0].srcset[1].height, 160);
		});
		it("reports if the sizes don't match their width specifier", async () => {
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
		<img src="image100x100.png" srcset="image200x200.png 200w, image110x100.png 100w" sizes="100px" id="bad" alt="img">
		<img src="image100x100.png" srcset="image200x200.png 200w, image100x100.png 100w" sizes="100px" id="good" alt="img">
	</body>
</html>
				`
				},
				{
					filename: "image200x200.png",
					contents: await generateImage(200, 200),
				},
				{
					filename: "image100x100.png",
					contents: await generateImage(100, 100),
				},
				{
					filename: "image110x100.png",
					contents: await generateImage(110, 100),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
			assert(errors[0].type === "IMG_SRC_INVALID");
			assert(errors[0].location.location.outerHTML.includes("bad"));
			assert(errors[0].srcset);
			assert("width" in errors[0].srcset[0].descriptor);
			assert("width" in errors[0].srcset[1].descriptor);
			assert.equal(errors[0].srcset[0].descriptor.width, 200);
			assert.equal(errors[0].srcset[0].width, 200);
			assert.equal(errors[0].srcset[1].descriptor.width, 100);
			assert.equal(errors[0].srcset[1].width, 110);
		});
		it("reports if the sizes property has only one value and it is in px and it does not match a width source", async () => {
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
		<img src="image100x100.png" srcset="image200x200.png 200w, image100x100.png 100w" sizes="110px" id="bad" alt="img">
		<img src="image100x100.png" srcset="image200x200.png 200w, image100x100.png 100w" sizes="100px" id="good" alt="img">
	</body>
</html>
				`
				},
				{
					filename: "image200x200.png",
					contents: await generateImage(200, 200),
				},
				{
					filename: "image100x100.png",
					contents: await generateImage(100, 100),
				},
			])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
			assert.equal(errors.length, 1, JSON.stringify(errors, undefined, 4));
			assert(errors[0].type === "IMG_SRC_INVALID");
			assert(errors[0].location.location.outerHTML.includes("bad"));
			assert(errors[0].srcset);
			assert("width" in errors[0].srcset[0].descriptor);
			assert("width" in errors[0].srcset[1].descriptor);
			assert.equal(errors[0].srcset[0].descriptor.width, 200);
			assert.equal(errors[0].srcset[0].width, 200);
			assert.equal(errors[0].srcset[1].descriptor.width, 100);
			assert.equal(errors[0].srcset[1].width, 100);
			assert.equal(errors[0].sizes, "110px");
		});
	});
});
