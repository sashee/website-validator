import {LinkLocation, UrlRole, Assertion, FoundPageFetchResult, log, getRedirect} from "./index.js";
import {parseSrcset} from "srcset";
import _robotsParser from "robots-parser";
import xml2js from "xml2js";
import jmespath from "jmespath";
import fs from "node:fs/promises";
import path from "node:path";
import {extractAllUrlsFromCss, getInterestingPageElements} from "./utils.js";
import {DeepReadonly} from "ts-essentials";

// can be removed when robots-parser is converted to ESM
const robotsParser = _robotsParser as any as typeof _robotsParser.default;

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

export const getLinks = async (url: string, role: DeepReadonly<UrlRole>, res: FoundPageFetchResult): Promise<DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]>> => {
	const contentType = Object.entries(res.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
	const redirect = await getRedirect(res);
	if (redirect !== undefined) {
		return [{url: redirect, role, asserts: [], location: {type: "redirect"}}];
	}else if (role.type === "robotstxt") {
		const contents = await fs.readFile(res.data.path);
		const robots = robotsParser(url, contents.toString("utf8"));
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
		const pageElements = await getInterestingPageElements(res.data);
		const linkAssets = pageElements.tagCollections.link.filter((link) => link.attrs["href"]).map((link) => {
			const {asserts, role, location} = (() => {
				if(link.attrs["rel"] === "stylesheet") {
					log("link is a stylesheet: url: %s, link: %O, res: %O", url, link.outerHTML, res);
					return {
						role: {type: "stylesheet"},
						asserts: [],
						location: {type: "html", element: {outerHTML: link.outerHTML, selector: link.selector}},
					} as const;
				}else if (link.attrs["rel"] === "alternate" && link.attrs["type"] === "application/atom+xml") {
					return {
						role: {type: "atom"},
						asserts: [],
						location: {type: "html", element: {outerHTML: link.outerHTML, selector: link.selector}},
					} as const;
				}else if (link.attrs["rel"] === "alternate" && link.attrs["type"] === "application/rss+xml") {
					return {
						role: {type: "rss"},
						asserts: [],
						location: {type: "html", element: {outerHTML: link.outerHTML, selector: link.selector}},
					} as const;
				}else if (link.attrs["rel"] === "icon" && link.attrs["sizes"]?.split(" ").length === 1) {
					const {width, height} = link.attrs["sizes"].split(" ")[0]!.toLowerCase().match(/^(?<width>\d+)x(?<height>\d+)$/)!.groups!;
					return {
						role: {type: "asset"},
						asserts: [{type: "image"}, {type: "imageSize", width: Number(width), height: Number(height)}],
						location: {type: "html", element: {outerHTML: link.outerHTML, selector: link.selector}},
					} as const;
				}else {
					return {role: {type: "asset"}, asserts: [], location: {type: "html", element: {outerHTML: link.outerHTML, selector: link.selector}}} as const;
				}
			})();
			const contentTypeAssertions = (() => {
				if (link.attrs["type"]) {
					// https://validator.w3.org/feed/docs/warning/UnexpectedContentType.html
					if (link.attrs["type"] === "application/rss+xml" || link.attrs["type"] === "application/atom+xml") {
						return [{type: "content-type", contentType: [link.attrs["type"], "application/xml"]}] as const;
					}else {
						return [{type: "content-type", contentType: [link.attrs["type"]]}] as const;
					}
				}else {
					return [];
				}
			})();
			const result = {url: new URL(link.attrs["href"]!, url).href, role, asserts: [...contentTypeAssertions, ...asserts], location};
			log("link result: url: %s, result: %O", url, result);
			return result;
		});
		const scriptAssets = pageElements.tagCollections.script.filter((script) => script.attrs["src"]).map((script) => {
			return {url: new URL(script.attrs["src"]!, url).href, role: {type: "asset"}, asserts: [], location: {type: "html", element: {outerHTML: script.outerHTML, selector: script.selector}}} as const;
		});
		const ogImages = pageElements.tagCollections.meta.filter((meta) => meta.attrs["property"] === "og:image" && meta.attrs["content"]).map((ogImage) => {
			return {url: new URL(ogImage.attrs["content"]!, url).href, role: {type: "asset"}, asserts: [{type: "image"}, {type: "permanent"}], location: {type: "html", element: {outerHTML: ogImage.outerHTML, selector: ogImage.selector}}} as const;
		});
		const imgSrcAssets = pageElements.tagCollections.img.filter((img) => img.attrs["src"]).map((img) => {
			return {url: new URL(img.attrs["src"]!, url).href, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: {outerHTML: img.outerHTML, selector: img.selector}}} as const;
		});
		const imgSrcsetAssets = pageElements.tagCollections.img.filter((img) => img.attrs["srcset"]).map((img) => {
			const parsed = parseSrcset(img.attrs["srcset"]!);
			return parsed.map((srcset) => ({url: new URL(srcset.url, url).href, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: {outerHTML: img.outerHTML, selector: img.selector}}} as const));
		}).flat();
		const videoSrcAssets = pageElements.tagCollections.video.filter((video) => video.attrs["src"]).map((video) => {
			return {url: new URL(video.attrs["src"]!, url).href, role: {type: "asset"}, asserts: [{type: "video"}], location: {type: "html", element: {outerHTML: video.outerHTML, selector: video.selector}}} as const;
		});
		const videoPosterAssets = pageElements.tagCollections.video.filter((video) => video.attrs["poster"]).map((video) => {
			return {url: new URL(video.attrs["poster"]!, url).href, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: {outerHTML: video.outerHTML, selector: video.selector}}} as const;
		});
		const links = pageElements.tagCollections.a.filter((a) => a.attrs["href"]).map((anchor) => {
			return {url: new URL(anchor.attrs["href"]!, url).href, role: {type: "asset"}, asserts: [], location: {type: "html", element: {outerHTML: anchor.outerHTML, selector: anchor.selector}}} as const;
		});
		const inJsonLd = pageElements.tagCollections.script.filter((script) => script.attrs["type"] === "application/ld+json").flatMap((script) => {
			try {
				const parsed = JSON.parse(script.innerHTML);
				const getLinksRecursive = (node: any): string[] => {
					if (typeof node === "string") {
						if (URL.canParse(node)) {
							return [node];
						}else {
							return [];
						}
					}else if (Array.isArray(node)) {
						return node.flatMap(getLinksRecursive);
					}else if (typeof node === "object") {
						return Object.values(node).flatMap(getLinksRecursive);
					}else {
						return [];
					}
				};
				return getLinksRecursive(parsed).map((link) => ({
					url: link,
					role: {type: "asset"},
					asserts: [],
					location: {type: "html", element: {outerHTML: script.outerHTML, selector: script.selector}}
				} as const));
			}catch(e) {
				// JSON/LD is validated separately, no need to throw here
				return [];
			}
		});
		return [...linkAssets, ...scriptAssets, ...ogImages, ...imgSrcAssets, ...imgSrcsetAssets, ...links, ...videoSrcAssets, ...videoPosterAssets, ...inJsonLd];
	}else if (contentType === "text/css") {
		const contents = await fs.readFile(res.data.path);
		const allUrls = await extractAllUrlsFromCss(contents.toString("utf8"));
		const pageUrl = url;
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
			return {url: new URL(url, pageUrl).href, role, asserts: asserts, location};
		});
	}else {
		return [];
	}
}

