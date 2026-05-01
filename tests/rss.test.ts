import {describe, it} from "node:test";
import { strict as assert } from "node:assert";
import {validate} from "../src/index.ts";
import {initFailIds, setupTestFiles} from "./testutils.ts";

const responseMeta = (filePath: string) => {
	const contentType = (() => {
		if (filePath.endsWith(".rss.xml")) {
			return "application/rss+xml";
		}else if (filePath.endsWith(".atom.xml")) {
			return "application/atom+xml";
		}else if (filePath.endsWith(".css")) {
			return "text/css";
		}else if (filePath.endsWith(".png")) {
			return "image/png";
		}else {
			return "text/html";
		}
	})();
	return {headers: {"Content-Type": contentType}, status: 200};
};

const validateRss = (rssContents: string, files: {filename: string, contents: string | Buffer}[] = []) => setupTestFiles([
	{
		filename: "index.html",
		contents: `
<!DOCTYPE html>
<html lang="en-us">
<head>
	<title>title</title>
	<link href="/feed.rss.xml" rel="alternate" type="application/rss+xml">
</head>
<body></body>
</html>
		`,
	},
	{
		filename: "feed.rss.xml",
		contents: rssContents,
	},
	...files,
])((dir) => validate({concurrency: 1})("https://example.com", {dir, responseMeta})([{url: "/", role: {type: "document"}}], {}, []));

const validateAtom = (atomContents: string, files: {filename: string, contents: string | Buffer}[] = []) => setupTestFiles([
	{
		filename: "index.html",
		contents: `
<!DOCTYPE html>
<html lang="en-us">
<head>
	<title>title</title>
	<link href="/feed.atom.xml" rel="alternate" type="application/atom+xml">
</head>
<body></body>
</html>
		`,
	},
	{
		filename: "feed.atom.xml",
		contents: atomContents,
	},
	...files,
])((dir) => validate({concurrency: 1})("https://example.com", {dir, responseMeta})([{url: "/", role: {type: "document"}}], {}, []));

const rss = (itemContents: string) => `
<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
	<title>Advanced Web Machinery</title>
	<description>Advanced Web Machinery</description>
	<link>https://example.com</link>
	<lastBuildDate>Fri, 08 Mar 2024 00:00:00 +0000</lastBuildDate>
	<pubDate>Fri, 08 Mar 2024 00:00:00 +0000</pubDate>
	<ttl>1800</ttl>
	<item>
		<title>Feed item</title>
		<guid isPermalink="false">feed-item</guid>
		<pubDate>Thu, 30 Apr 2026 00:00:00 +0000</pubDate>
		${itemContents}
	</item>
</channel>
</rss>
`;

const rssItems = (itemContents: string[]) => `
<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
	<title>Advanced Web Machinery</title>
	<description>Advanced Web Machinery</description>
	<link>https://example.com</link>
	${itemContents.map((contents, index) => `
	<item>
		<title>Feed item ${index}</title>
		<guid isPermalink="false">feed-item-${index}</guid>
		<pubDate>Thu, 30 Apr 2026 00:00:00 +0000</pubDate>
		${contents}
	</item>
	`).join("")}
</channel>
</rss>
`;

const atom = (entryContents: string) => `
<?xml version="1.0" encoding="UTF-8" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>Advanced Web Machinery</title>
	<link href="https://example.com/feed.atom.xml" rel="self"/>
	<link href="https://example.com"/>
	<updated>2024-03-08T00:00:00+00:00</updated>
	<id>https://example.com</id>
	<author>
		<name>Advanced Web Machinery</name>
		<email/>
	</author>
	<entry>
		<title>Feed entry</title>
		<updated>2024-03-08T00:00:00+00:00</updated>
		<id>feed-entry</id>
		${entryContents}
	</entry>
</feed>
`;

const atomEntries = (entryContents: string[]) => `
<?xml version="1.0" encoding="UTF-8" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>Advanced Web Machinery</title>
	<link href="https://example.com/feed.atom.xml" rel="self"/>
	<link href="https://example.com"/>
	<updated>2024-03-08T00:00:00+00:00</updated>
	<id>https://example.com</id>
	<author>
		<name>Advanced Web Machinery</name>
		<email/>
	</author>
	${entryContents.map((contents, index) => `
	<entry>
		<title>Feed entry ${index}</title>
		<updated>2024-03-08T00:00:00+00:00</updated>
		<id>feed-entry-${index}</id>
		${contents}
	</entry>
	`).join("")}
</feed>
`;

const htmlWithMissingLink = (failId: string) => `
<!DOCTYPE html>
<html lang="en-us">
<head><title>title</title></head>
<body><a href="https://example.com/${failId}.html">missing</a></body>
</html>
`;

const withoutVnu = (errors: Awaited<ReturnType<ReturnType<ReturnType<typeof validate>>>>) => errors.filter(({type}) => type !== "VNU");

describe("rss", () => {
	it("rejects when an item link is relative url", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateRss(rss(`<link>/${failId}</link><description>abc</description>`)));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url === `/${failId}` && error.location.type === "rssItemLink"));
	});

	it("rejects when an item link is path-relative url", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateRss(rss(`<link>${failId}.html</link><description>abc</description>`)));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url === `${failId}.html` && error.location.type === "rssItemLink"));
	});

	it("allows when an item link is outside the site", async () => {
		const errors = withoutVnu(await validateRss(rss(`<link>https://example.org/post.html</link><description>abc</description>`)));
		assert.deepEqual(errors, []);
	});

	it("rejects when an item link points to a nonexistent site page", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateRss(rss(`<link>https://example.com/${failId}.html</link><description>abc</description>`)));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId) && error.location.location.type === "rss"));
	});

	it("allows when an item link points to an existing site page", async () => {
		const errors = withoutVnu(await validateRss(
			rss(`<link>https://example.com/post.html</link><description>abc</description>`),
			[{filename: "post.html", contents: htmlWithMissingLink("not-referenced").replace("https://example.com/not-referenced.html", "https://example.org/not-referenced.html")}],
		));
		assert.deepEqual(errors, []);
	});

	it("rejects when an item description has a relative url", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const hrefFailId = nextFailId();
		const srcFailId = nextFailId();
		const srcsetFailId = nextFailId();
		const errors = withoutVnu(await validateRss(rss(`
			<link>https://example.org/post.html</link>
			<description><![CDATA[
				<a href="/${hrefFailId}.html">relative link</a>
				<img src="/${srcFailId}.png">
				<img srcset="/${srcsetFailId}.png 1x, https://example.com/good.png 2x">
			]]></description>
		`), [{filename: "good.png", contents: "png"}]));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		getFailIds().forEach((failId) => {
			assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url.includes(failId) && error.location.type === "rssItemDescriptionHtml"), `Should have an error but did not: ${failId}`);
		});
	});

	it("rejects when escaped item description html has a relative url", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateRss(rss(`
			<link>https://example.org/post.html</link>
			<description>&lt;a href=&quot;/${failId}.html&quot;&gt;relative link&lt;/a&gt;</description>
		`)));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url === `/${failId}.html` && error.location.type === "rssItemDescriptionHtml" && error.location.element.tagName === "a" && error.location.element.attribute === "href"));
	});

	it("reports item description relative url locations with element details", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateRss(rssItems([
			`<link>https://example.org/first.html</link><description>abc</description>`,
			`<link>https://example.org/second.html</link><description><![CDATA[<img src="/${failId}.png">]]></description>`,
		])));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url === `/${failId}.png` && error.location.type === "rssItemDescriptionHtml" && error.location.channelIndex === 0 && error.location.itemIndex === 1 && error.location.element.tagName === "img" && error.location.element.attribute === "src"));
	});

	it("allows when an item description has a url outside the site", async () => {
		const errors = withoutVnu(await validateRss(rss(`
			<link>https://example.org/post.html</link>
			<description><![CDATA[
				<a href="https://example.org/post.html">external link</a>
				<img src="https://example.org/image.png">
				<img srcset="https://example.org/image-small.png 1x, https://example.org/image-large.png 2x">
			]]></description>
		`)));
		assert.deepEqual(errors, []);
	});

	it("rejects when an item description has a site url that does not exist", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const hrefFailId = nextFailId();
		const srcFailId = nextFailId();
		const srcsetFailId = nextFailId();
		const errors = withoutVnu(await validateRss(rss(`
			<link>https://example.org/post.html</link>
			<description><![CDATA[
				<a href="https://example.com/${hrefFailId}.html">missing link</a>
				<img src="https://example.com/${srcFailId}.png">
				<img srcset="https://example.com/${srcsetFailId}.png 1x, https://example.com/good.png 2x">
			]]></description>
		`), [{filename: "good.png", contents: "png"}]));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		getFailIds().forEach((failId) => {
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId)), `Should have an error but did not: ${failId}`);
		});
	});

	describe("discovered urls", () => {
		it("validates a document that is only linked from an item link", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const errors = withoutVnu(await validateRss(rss(`<link>https://example.com/post.html</link><description>abc</description>`), [{filename: "post.html", contents: htmlWithMissingLink(failId)}]));
			assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId)));
		});

		it("validates a document that is only linked from item description html", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const errors = withoutVnu(await validateRss(rss(`
				<link>https://example.org/post.html</link>
				<description><![CDATA[<a href="https://example.com/post.html">post</a>]]></description>
			`), [{filename: "post.html", contents: htmlWithMissingLink(failId)}]));
			assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId)));
		});

		it("validates an asset that is only linked from item description html", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const errors = withoutVnu(await validateRss(rss(`
				<link>https://example.org/post.html</link>
				<description><![CDATA[<img src="https://example.com/${failId}.png">]]></description>
			`)));
			assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId)));
		});
	});
});

describe("atom", () => {
	it("rejects when an entry link is relative url", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateAtom(atom(`<link href="/${failId}"/><content type="html">abc</content>`)));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url === `/${failId}` && error.location.type === "atomEntryLink"));
	});

	it("rejects when an entry link is path-relative url", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateAtom(atom(`<link href="${failId}.html"/><content type="html">abc</content>`)));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url === `${failId}.html` && error.location.type === "atomEntryLink"));
	});

	it("reports entry link relative url locations with entry and link indexes", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateAtom(atomEntries([
			`<link href="https://example.org/first.html"/><content type="html">abc</content>`,
			`<link href="https://example.org/alternate.html"/><link href="/${failId}.html"/><content type="html">abc</content>`,
		])));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url === `/${failId}.html` && error.location.type === "atomEntryLink" && error.location.entryIndex === 1 && error.location.linkIndex === 1));
	});

	it("allows when an entry link is outside the site", async () => {
		const errors = withoutVnu(await validateAtom(atom(`<link href="https://example.org/post.html"/><content type="html">abc</content>`)));
		assert.deepEqual(errors, []);
	});

	it("rejects when an entry link points to a nonexistent site page", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateAtom(atom(`<link href="https://example.com/${failId}.html"/><content type="html">abc</content>`)));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId) && error.location.location.type === "atom"));
	});

	it("allows when an entry link points to an existing site page", async () => {
		const errors = withoutVnu(await validateAtom(
			atom(`<link href="https://example.com/post.html"/><content type="html">abc</content>`),
			[{filename: "post.html", contents: htmlWithMissingLink("not-referenced").replace("https://example.com/not-referenced.html", "https://example.org/not-referenced.html")}],
		));
		assert.deepEqual(errors, []);
	});

	it("rejects when an entry content has a relative url", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const hrefFailId = nextFailId();
		const srcFailId = nextFailId();
		const srcsetFailId = nextFailId();
		const errors = withoutVnu(await validateAtom(atom(`
			<link href="https://example.org/post.html"/>
			<content type="html"><![CDATA[
				<a href="/${hrefFailId}.html">relative link</a>
				<img src="/${srcFailId}.png">
				<img srcset="/${srcsetFailId}.png 1x, https://example.com/good.png 2x">
			]]></content>
		`), [{filename: "good.png", contents: "png"}]));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		getFailIds().forEach((failId) => {
			assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url.includes(failId) && error.location.type === "atomEntryContentHtml"), `Should have an error but did not: ${failId}`);
		});
	});

	it("rejects when escaped entry content html has a relative url", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const failId = nextFailId();
		const errors = withoutVnu(await validateAtom(atom(`
			<link href="https://example.org/post.html"/>
			<content type="html">&lt;a href=&quot;/${failId}.html&quot;&gt;relative link&lt;/a&gt;</content>
		`)));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		assert(errors.some((error) => error.type === "FEED_RELATIVE_URL" && error.url === `/${failId}.html` && error.location.type === "atomEntryContentHtml" && error.location.element.tagName === "a" && error.location.element.attribute === "href"));
	});

	it("allows when an entry content has a url outside the site", async () => {
		const errors = withoutVnu(await validateAtom(atom(`
			<link href="https://example.org/post.html"/>
			<content type="html"><![CDATA[
				<a href="https://example.org/post.html">external link</a>
				<img src="https://example.org/image.png">
				<img srcset="https://example.org/image-small.png 1x, https://example.org/image-large.png 2x">
			]]></content>
		`)));
		assert.deepEqual(errors, []);
	});

	it("rejects when an entry content has a site url that does not exist", async () => {
		const {nextFailId, getFailIds} = initFailIds();
		const hrefFailId = nextFailId();
		const srcFailId = nextFailId();
		const srcsetFailId = nextFailId();
		const errors = withoutVnu(await validateAtom(atom(`
			<link href="https://example.org/post.html"/>
			<content type="html"><![CDATA[
				<a href="https://example.com/${hrefFailId}.html">missing link</a>
				<img src="https://example.com/${srcFailId}.png">
				<img srcset="https://example.com/${srcsetFailId}.png 1x, https://example.com/good.png 2x">
			]]></content>
		`), [{filename: "good.png", contents: "png"}]));
		assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
		getFailIds().forEach((failId) => {
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId)), `Should have an error but did not: ${failId}`);
		});
	});

	describe("discovered urls", () => {
		it("validates a document that is only linked from an entry link", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const errors = withoutVnu(await validateAtom(atom(`<link href="https://example.com/post.html"/><content type="html">abc</content>`), [{filename: "post.html", contents: htmlWithMissingLink(failId)}]));
			assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId)));
		});

		it("validates a document that is only linked from entry content html", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const errors = withoutVnu(await validateAtom(atom(`
				<link href="https://example.org/post.html"/>
				<content type="html"><![CDATA[<a href="https://example.com/post.html">post</a>]]></content>
			`), [{filename: "post.html", contents: htmlWithMissingLink(failId)}]));
			assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId)));
		});

		it("validates an asset that is only linked from entry content html", async () => {
			const {nextFailId, getFailIds} = initFailIds();
			const failId = nextFailId();
			const errors = withoutVnu(await validateAtom(atom(`
				<link href="https://example.org/post.html"/>
				<content type="html"><![CDATA[<img src="https://example.com/${failId}.png">]]></content>
			`)));
			assert.equal(errors.length, getFailIds().length, JSON.stringify(errors, undefined, 4));
			assert(errors.some((error) => error.type === "TARGET_NOT_FOUND" && error.location.url.includes(failId)));
		});
	});
});
