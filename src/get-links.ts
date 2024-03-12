import {LinkLocation, UrlRole, Assertion, FoundPageFetchResult} from "./index.js";
import {parseSrcset} from "srcset";
import robotsParser from "robots-parser";
import xml2js from "xml2js";
import jmespath from "jmespath";
import fs from "node:fs/promises";
import path from "node:path";
import {JSDOM} from "jsdom";
import {extractAllUrlsFromCss, getElementLocation} from "./utils.js";
import {DeepReadonly} from "ts-essentials";

export const getUrlsFromSitemap = async (contents: string, type: "xml" | "txt") => {
	switch(type) {
		case "xml": {
			const parsed = await xml2js.parseStringPromise(contents);
			return (parsed.urlset.url as {loc: string[]}[]).flatMap(({loc}, urlsetIndex) => loc.map((l) => ({loc: l, urlsetIndex}))).map(({loc, urlsetIndex}, urlIndex) => ({
				url: loc,
				role: {type: "document"},
				asserts: [{type: "permanent"}],
				location: {type: "sitemapxml", urlsetIndex, urlIndex},
			} as const));
		}
		case "txt": {
			return contents.split("\n").map((line, index) => [index, line.trim()] as const).filter(([, line]) => line !== "").map(([index, url]) => ({
				url,
				role: {type: "document"},
				asserts: [{type: "permanent"}],
				location: {type: "sitemaptxt", index},
			} as const));
		}
	}
}

export const getLinks = async (baseUrl: string, url: string, role: DeepReadonly<UrlRole>, res: FoundPageFetchResult): Promise<DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]>> => {
	const contentType = res.headers.find(([name]) => name.toLowerCase() === "content-type")![1];
	if (role.type === "robotstxt") {
		const contents = await fs.readFile(res.data.path);
		const robots = (robotsParser)(url, contents.toString("utf8"));
		const sitemaps = robots.getSitemaps();
		return sitemaps.map((url, index) => ({url, role: {type: "sitemap"}, asserts: [], location: {type: "robotssitemap", index}}));
	}else if (role.type === "sitemap") {
		const contents = await fs.readFile(res.data.path);
		const extension = path.extname(new URL(url).pathname);

		return (await getUrlsFromSitemap(contents.toString("utf8"), extension === ".txt" ? "txt" : "xml")).map(({location, ...rest}) => {
			return {
				...rest,
				location: {
					...location,
					sitemaplocation: {
						url,
					},
				}
			}
		});
	}else if (role.type === "rss") {
		const contents = await fs.readFile(res.data.path);
		const parsed = await xml2js.parseStringPromise(contents.toString("utf8"));
		return (parsed.rss.channel as {item: {link: string[]}[] | undefined}[]).flatMap((channel, channelIndex) => ((channel.item ?? []).map((c) => ({link: c.link, channelIndex}))).flatMap(({link, channelIndex}, linkIndex) => ({link, linkIndex, channelIndex}))).flatMap(({link, channelIndex, linkIndex}) => link.map((l) => ({
			url: l,
			role: {type: "document"},
			asserts: [{type: "permanent"}],
			location: {type: "rss", rssurl: url, channelIndex, linkIndex},
		} as const)));
	}else if (role.type === "atom") {
		const contents = await fs.readFile(res.data.path);
		const parsed = await xml2js.parseStringPromise(contents.toString("utf8"));
		return (parsed.feed.entry as {link: {$: {href: string}}[]}[] | undefined ?? []).flatMap((entry, entryIndex) => entry.link.flatMap((link, linkIndex) => ({href: link.$.href, entryIndex, linkIndex}))).map(({href, entryIndex, linkIndex}) => ({
			url: href,
			role: {type: "document"},
			asserts: [{type: "permanent"}],
			location: {type: "atom", atomurl: url, entryIndex, linkIndex},
		} as const));
	}else if (role.type === "json") {
		const contents = await fs.readFile(res.data.path);
		const asJson = JSON.parse(contents.toString("utf8"));
		return role.extractConfigs.flatMap((extractConfig) => ((jmespath.search(asJson, extractConfig.jmespath) ?? []) as string[]).map((link, index) => ({
			url: link,
			role: extractConfig.role,
			asserts: extractConfig.asserts,
			location: {type: "json", jsonurl: url, jmespath: extractConfig.jmespath, index},
		})));
	}else if (role.type === "document" || contentType === "text/html") {
		const contents = await fs.readFile(res.data.path);
		const dom = new JSDOM(contents.toString("utf8"), {url: baseUrl})
		const linkAssets = [...dom.window.document.querySelectorAll("link[href]") as NodeListOf<HTMLLinkElement>].map((link) => {
			const {asserts, role, location} = (() => {
				if(link.rel === "stylesheet") {
					return {
						role: {type: "stylesheet"},
						asserts: [],
						location: {type: "html", element: {outerHTML: link.outerHTML, selector: getElementLocation(link)}},
					} as const;
				}else if (link.rel === "alternate" && link.type === "application/atom+xml") {
					return {
						role: {type: "atom"},
						asserts: [],
						location: {type: "html", element: {outerHTML: link.outerHTML, selector: getElementLocation(link)}},
					} as const;
				}else if (link.rel === "alternate" && link.type === "application/rss+xml") {
					return {
						role: {type: "rss"},
						asserts: [],
						location: {type: "html", element: {outerHTML: link.outerHTML, selector: getElementLocation(link)}},
					} as const;
				}else if (link.rel === "icon" && link.sizes?.length === 1) {
					const {width, height} = link.sizes.item(0)!.toLowerCase().match(/^(?<width>\d+)x(?<height>\d+)$/)!.groups!;
					return {
						role: {type: "asset"},
						asserts: [{type: "image"}, {type: "imageSize", width: Number(width), height: Number(height)}],
						location: {type: "html", element: {outerHTML: link.outerHTML, selector: getElementLocation(link)}},
					} as const;
				}else {
					return {role: {type: "asset"}, asserts: [], location: {type: "html", element: {outerHTML: link.outerHTML, selector: getElementLocation(link)}}} as const;
				}
			})();
			const contentTypeAssertions = (() => {
				if (link.type) {
					// https://validator.w3.org/feed/docs/warning/UnexpectedContentType.html
					if (link.type === "application/rss+xml" || link.type === "application/atom+xml") {
						return [{type: "content-type", contentType: [link.type, "application/xml"]}] as const;
					}else {
						return [{type: "content-type", contentType: [link.type]}] as const;
					}
				}else {
					return [];
				}
			})();
			return {url: link.href, role, asserts: [...contentTypeAssertions, ...asserts], location};
		});
		const scriptAssets = [...dom.window.document.querySelectorAll("script[src]") as NodeListOf<HTMLScriptElement>].map((script) => {
			return {url: script.src, role: {type: "asset"}, asserts: [], location: {type: "html", element: {outerHTML: script.outerHTML, selector: getElementLocation(script)}}} as const;
		});
		const ogImages = [...dom.window.document.querySelectorAll("meta[property='og:image']") as NodeListOf<HTMLMetaElement>].map((ogImage) => {
			return {url: ogImage.content, role: {type: "asset"}, asserts: [{type: "image"}, {type: "permanent"}], location: {type: "html", element: {outerHTML: ogImage.outerHTML, selector: getElementLocation(ogImage)}}} as const;
		});
		const imgSrcAssets = [...dom.window.document.querySelectorAll("img[src]") as NodeListOf<HTMLImageElement>].map((img) => {
			return {url: img.src, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: {outerHTML: img.outerHTML, selector: getElementLocation(img)}}} as const;
		});
		const imgSrcsetAssets = [...dom.window.document.querySelectorAll("img[srcset]") as NodeListOf<HTMLImageElement>].map((img) => {
			const parsed = parseSrcset(img.getAttribute("srcset")!);
			return parsed.map(({url}) => ({url, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: {outerHTML: img.outerHTML, selector: getElementLocation(img)}}} as const));
		}).flat();
		const videoSrcAssets = [...dom.window.document.querySelectorAll("video[src]") as NodeListOf<HTMLVideoElement>].map((video) => {
			return {url: video.src, role: {type: "asset"}, asserts: [{type: "video"}], location: {type: "html", element: {outerHTML: video.outerHTML, selector: getElementLocation(video)}}} as const;
		});
		const videoPosterAssets = [...dom.window.document.querySelectorAll("video[poster]") as NodeListOf<HTMLVideoElement>].map((video) => {
			return {url: video.poster, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: {outerHTML: video.outerHTML, selector: getElementLocation(video)}}} as const;
		});
		const links = [...dom.window.document.querySelectorAll("a[href]") as NodeListOf<HTMLAnchorElement>].map((anchor) => {
			return {url: anchor.href, role: {type: "asset"}, asserts: [], location: {type: "html", element: {outerHTML: anchor.outerHTML, selector: getElementLocation(anchor)}}} as const;
		});
		return [...linkAssets, ...scriptAssets, ...ogImages, ...imgSrcAssets, ...imgSrcsetAssets, ...links, ...videoSrcAssets, ...videoPosterAssets];
	}else if (contentType === "text/css") {
		const contents = await fs.readFile(res.data.path);
		const allUrls = await extractAllUrlsFromCss(contents.toString("utf8"));
		return allUrls.map(({url, parent, prop, position}) => {
			const {asserts, role, location} = (() => {
				if (parent === "@font-face" && prop === "src") {
					return {
						role: {type: "asset"},
						asserts: [{type: "font"}],
						location: {type: "css", position, target: url}
					} as const;
				}else {
					return {role: {type: "asset"}, asserts: [], location: {type: "css", position, target: url}} as const;
				}
			})();
			return {url, role, asserts: asserts, location};
		});
	}else {
		return [];
	}
}

