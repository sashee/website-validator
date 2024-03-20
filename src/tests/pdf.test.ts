import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../index.js";
import {setupTestFiles} from "./testutils.js";
import muhammara from "muhammara";
import streams from "memory-streams";

const generatePdf = async () => {
	const writer = new streams.WritableStream();
	const pdfWriter = muhammara.createWriter(new muhammara.PDFStreamForResponse(writer));
	const page = pdfWriter.createPage();
	const pageContent = pdfWriter.startPageContentContext(page);
	pageContent.q().k(100, 0, 0, 0).re(100, 500, 100, 100).f().Q();
	pdfWriter.writePage(page);
	pdfWriter.end();
	return writer.toBuffer();
};

describe("pdf", () => {
	it("reports no errors for a valid pdf file", async () => {
		const pdf = await generatePdf();
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
		<a href="test.pdf">pdf file</a>
	</body>
</html>
			`
			},
			{
				filename: "test.pdf",
				contents: pdf,
			}
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		assert.equal(errors.length, 0);
	});
	it("reports errors for an invalid pdf file", async () => {
		const pdf = await generatePdf();
		// make the pdf file not valid
		pdf.set([24], 0);
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
		<a href="test.pdf">pdf file</a>
	</body>
</html>
			`
			},
			{
				filename: "test.pdf",
				contents: pdf,
			}
		])((dir) => validate({concurrency: 1})("https://example.com", {dir, indexName: "index.html"})([{url: "/", role: {type: "document"}}], {}));
		console.log(JSON.stringify(errors, undefined, 4));
		assert.equal(errors.length, 1);
		assert(errors[0].type === "PDFCHECK" && errors[0].location.url.includes("test.pdf"), `Should have an error but did not`);
	});
});
