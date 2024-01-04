import {startStaticFileServer, extractAllUrlsFromCss, getElementLocation} from "./utils.js";
import getPort from "get-port";
import {JSDOM} from "jsdom";
import Rx from "rxjs";
import RxJsOperators from "rxjs/operators";
import {parseSrcset} from "srcset";
import crypto from "crypto";
import robotsParser from "robots-parser";
import path from "node:path";
import xml2js from "xml2js";
import jmespath from "jmespath";
import deepEqual from "deep-equal";
import fs from "node:fs/promises";
import mime from "mime";

type FileFetchResult = {
	headers: [string, string][],
	data: string | null,
}

type FoundPageFetchResult = {
	headers: FileFetchResult["headers"],
	data: NonNullable<FileFetchResult["data"]>,
}

export const sha = (x: crypto.BinaryLike) => crypto.createHash("sha256").update(x).digest("hex");

const toCanonical = (baseUrl: string, indexName: string) => (url: string) => {
	const urlObj = new URL(url, baseUrl);
	if (urlObj.protocol !== new URL(baseUrl).protocol) {
		return url;
	}else {
		const resolvedPathName = urlObj.pathname.endsWith("/") ? urlObj.pathname + indexName : urlObj.pathname;
		return urlObj.origin + resolvedPathName + urlObj.search;
	}
}

const isInternalLink = (baseUrl: string) => (url: string) => {
	return new URL(url, baseUrl).origin === baseUrl;
}
const toRelativeUrl = (baseUrl: string) => (url: string) => {
	const urlObj = new URL(url, baseUrl);
	return urlObj.pathname + urlObj.search;
}

const parseJsdom = (() => {
	const cache = {} as {[cacheKey: string]: JSDOM};
	return (html: string, baseUrl: string) => {
		const cacheKey = sha(html) + sha(baseUrl);
		if (cache[cacheKey]) {
			return cache[cacheKey];
		}else {
			const result = new JSDOM(html, {url: baseUrl});
			//cache[cacheKey] = result;
			return result;
		}
	}
})();

type UrlRole = {
	type: "document",
} | {
	type: "stylesheet",
} | {
	type: "asset",
} | {
	type: "sitemap",
} | {
	type: "robotstxt",
} | {
	type: "rss",
} | {
	type: "atom",
} | {
	type: "json",
	extractConfigs: {jmespath: string, asserts: Assertion[], role: UrlRole}[],
}

type AssertImage = {type: "image"};
type AssertVideo = {type: "video"};
type AssertFont = {type: "font"};
type AssertImageSize = {type: "imageSize", width: number, height: number};
type AssertContentType = {type: "content-type", contentType: readonly string[]};
type AssertPermanent = {type: "permanent"};

type Assertion = AssertImage | AssertVideo | AssertFont | AssertImageSize | AssertContentType | AssertPermanent;

type LinkLocation = {
	type: "html",
	element: Element,
} | {
	type: "robotssitemap",
	index: number,
} | {
	type: "sitemaptxt",
	index: number,
} | {
	type: "sitemapxml",
	urlsetIndex: number,
	urlIndex: number,
} | {
	type: "rss",
	channelIndex: number,
	linkIndex: number,
} | {
	type: "atom",
	entryIndex: number,
	linkIndex: number,
} | {
	type: "json",
	jmespath: string,
	index: number,
} | {
	type: "css",
	position: string,
}

const getLinks = (baseUrl: string) => async ({url, role, res}: {url: string, role: UrlRole, res: FoundPageFetchResult}): Promise<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]> => {
	const contentType = res.headers.find(([name]) => name.toLowerCase() === "content-type")![1];
	if (role.type === "robotstxt") {
		const contents = await fs.readFile(res.data);
		const robots = (robotsParser as any as typeof robotsParser.default)(url, contents.toString("utf8"));
		const sitemaps = robots.getSitemaps();
		return sitemaps.map((url, index) => ({url, role: {type: "sitemap"}, asserts: [], location: {type: "robotssitemap", index}}));
	}else if (role.type === "sitemap") {
		const contents = await fs.readFile(res.data);
		const extension = path.extname(new URL(url).pathname);
		if (extension === ".txt") {
			// txt sitemap
			return contents.toString("utf8").split("\n").map((line, index) => [index, line.trim()] as const).filter(([, line]) => line !== "").map(([index, url]) => ({
				url,
				role: {type: "document"},
				asserts: [{type: "permanent"}],
				location: {type: "sitemaptxt", index},
			} as const));
		}else {
			// xml sitemap
			const contents = await fs.readFile(res.data);
			const parsed = await xml2js.parseStringPromise(contents.toString("utf8"));
			return (parsed.urlset.url as {loc: string[]}[]).flatMap(({loc}, urlsetIndex) => loc.map((l) => ({loc: l, urlsetIndex}))).map(({loc, urlsetIndex}, urlIndex) => ({
				url: loc,
				role: {type: "document"},
				asserts: [{type: "permanent"}],
				location: {type: "sitemapxml", urlsetIndex, urlIndex},
			} as const));
		}
	}else if (role.type === "rss") {
		const contents = await fs.readFile(res.data);
		const parsed = await xml2js.parseStringPromise(contents.toString("utf8"));
		return (parsed.rss.channel as {item: {link: string}[]}[]).flatMap((channel, channelIndex) => (channel.item.map((c) => ({link: c.link, channelIndex}))).flatMap(({link, channelIndex}, linkIndex) => ({url: link, linkIndex, channelIndex}))).map(({url, channelIndex, linkIndex}) => ({
			url,
			role: {type: "document"},
			asserts: [{type: "permanent"}],
			location: {type: "rss", channelIndex, linkIndex},
		} as const));
	}else if (role.type === "atom") {
		const contents = await fs.readFile(res.data);
		const parsed = await xml2js.parseStringPromise(contents.toString("utf8"));
		return (parsed.feed.entry as {link: {$: {href: string}}[]}[]).flatMap((entry, entryIndex) => entry.link.flatMap((link, linkIndex) => ({href: link.$.href, entryIndex, linkIndex}))).map(({href, entryIndex, linkIndex}) => ({
			url: href,
			role: {type: "document"},
			asserts: [{type: "permanent"}],
			location: {type: "atom", entryIndex, linkIndex},
		} as const));
	}else if (role.type === "json") {
		const contents = await fs.readFile(res.data);
		const asJson = JSON.parse(contents.toString("utf8"));
		return role.extractConfigs.flatMap((extractConfig) => (jmespath.search(asJson, extractConfig.jmespath) as string[]).map((url, index) => ({
			url,
			role: extractConfig.role,
			asserts: extractConfig.asserts,
			location: {type: "json", jmespath: extractConfig.jmespath, index},
		})));
	}else if (role.type === "document" || contentType === "text/html") {
		const contents = await fs.readFile(res.data);
		const dom = parseJsdom(contents.toString("utf8"), baseUrl)!;
		const linkAssets = [...dom.window.document.querySelectorAll("link[href]") as NodeListOf<HTMLLinkElement>].map((link) => {
			const {asserts, role, location} = (() => {
				if(link.rel === "stylesheet") {
					return {
						role: {type: "stylesheet"},
						asserts: [],
						location: {type: "html", element: link},
					} as const;
				}else if (link.rel === "alternate" && link.type === "application/atom+xml") {
					return {
						role: {type: "atom"},
						asserts: [],
						location: {type: "html", element: link},
					} as const;
				}else if (link.rel === "alternate" && link.type === "application/rss+xml") {
					return {
						role: {type: "rss"},
						asserts: [],
						location: {type: "html", element: link},
					} as const;
				}else if (link.rel === "icon" && link.sizes?.length === 1) {
					const {width, height} = link.sizes.item(0)!.toLowerCase().match(/^(?<width>\d+)x(?<height>\d+)$/)!.groups!;
					return {
						role: {type: "asset"},
						asserts: [{type: "image"}, {type: "imageSize", width: Number(width), height: Number(height)}],
						location: {type: "html", element: link},
					} as const;
				}else {
					return {role: {type: "asset"}, asserts: [], location: {type: "html", element: link}} as const;
				}
			})();
			return {url: link.href, role, asserts: [...(link.type ? [{type: "content-type", contentType: [link.type]}] as const : []), ...asserts], location};
		});
		const scriptAssets = [...dom.window.document.querySelectorAll("script[src]") as NodeListOf<HTMLScriptElement>].map((script) => {
			return {url: script.src, role: {type: "asset"}, asserts: [], location: {type: "html", element: script}} as const;
		});
		const ogImages = [...dom.window.document.querySelectorAll("meta[property='og:image']") as NodeListOf<HTMLMetaElement>].map((ogImage) => {
			return {url: ogImage.content, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: ogImage}} as const;
		});
		const imgSrcAssets = [...dom.window.document.querySelectorAll("img[src]") as NodeListOf<HTMLImageElement>].map((img) => {
			return {url: img.src, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: img}} as const;
		});
		const imgSrcsetAssets = [...dom.window.document.querySelectorAll("img[srcset]") as NodeListOf<HTMLImageElement>].map((img) => {
			const parsed = parseSrcset(img.getAttribute("srcset")!);
			return parsed.map(({url}) => ({url, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: img}} as const));
		}).flat();
		const videoSrcAssets = [...dom.window.document.querySelectorAll("video[src]") as NodeListOf<HTMLVideoElement>].map((video) => {
			return {url: video.src, role: {type: "asset"}, asserts: [{type: "video"}], location: {type: "html", element: video}} as const;
		});
		const videoPosterAssets = [...dom.window.document.querySelectorAll("video[poster]") as NodeListOf<HTMLVideoElement>].map((video) => {
			return {url: video.poster, role: {type: "asset"}, asserts: [{type: "image"}], location: {type: "html", element: video}} as const;
		});
		const links = [...dom.window.document.querySelectorAll("a[href]") as NodeListOf<HTMLAnchorElement>].map((anchor) => {
			return {url: anchor.href, role: {type: "asset"}, asserts: [], location: {type: "html", element: anchor}} as const;
		});
		return [...linkAssets, ...scriptAssets, ...ogImages, ...imgSrcAssets, ...imgSrcsetAssets, ...links, ...videoSrcAssets, ...videoPosterAssets];
	}else if (contentType === "text/css") {
		const contents = await fs.readFile(res.data);
		const allUrls = await extractAllUrlsFromCss(contents.toString("utf8"));
		return allUrls.map(({url, parent, prop, position}) => {
			const {asserts, role, location} = (() => {
				if (parent === "@font-face" && prop === "src") {
					return {
						role: {type: "asset"},
						asserts: [{type: "font"}],
						location: {type: "css", position}
					} as const;
				}else {
					return {role: {type: "asset"}, asserts: [], location: {type: "css", position}} as const;
				}
			})();
			return {url, role, asserts: asserts, location};
		});
	}else {
		return [];
	}
}


export const validate = (dir: string, baseUrl: string, indexName: string = "index.html") => async (fetchBases: {url: string, role: UrlRole}[]) => {
	const port = await getPort();
	const app = await startStaticFileServer(dir, port, indexName);
	try {
		const fetchFile = (() => {
			return async (url: string): Promise<FileFetchResult> => {
				if (!isInternalLink(url)) {
					throw new Error(`Link not internal: ${url}`);
				}
				const filePath = path.join(dir, toRelativeUrl(baseUrl)(toCanonical(baseUrl, indexName)(url)));
				try {
					await fs.access(filePath, fs.constants.R_OK);
					return {
						headers: [
							["content-type", mime.getType(path.extname(filePath)) ?? "application/octet-stream"]
						],
						data: filePath,
					}
				}catch {
					return {
						headers: [],
						data: null,
					};
				}
			}
		})();

		const fetchFiles = async (startUrls: {url: string, role: UrlRole}[]) => {
			const urlSubject = new Rx.Subject<{url: string, role: UrlRole}>();
			const uniqueUrls = urlSubject.pipe(
				RxJsOperators.scan(({cache}, {url, role}) => {
					if (cache.find((cacheElement) => url === cacheElement.url && deepEqual(role, cacheElement.role))) {
						return {cache, emit: []};
					}else {
						return {cache: [...cache, {url, role}], emit: [{url, role}]};
					}
				}, {cache: [] as {url: string, role: UrlRole}[], emit: [] as {url: string, role: UrlRole}[]}),
				RxJsOperators.filter(({emit}) => emit.length > 0),
				RxJsOperators.mergeMap(({emit}) => emit),
				RxJsOperators.share(),
			);
			const results = uniqueUrls.pipe(
				RxJsOperators.mergeMap(async ({url, role}) => {
					const res = await fetchFile(url);

					return {
						url,
						role,
						res,
					};
				}, 10),
				RxJsOperators.mergeMap(async ({url, role, res}) => {
					if (res.data !== null) {
						const discoveredUrls = await (async () => {
							const links = await getLinks(toCanonical(baseUrl, indexName)(url))({url, role, res: res as FoundPageFetchResult});
							return links.map((link) => ({url: toCanonical(url, indexName)(link.url), role: link.role}));
						})();
						discoveredUrls.filter(({url}) => isInternalLink(baseUrl)(url)).forEach(({url, role}) => urlSubject.next({url, role}));
					}
					return {url, role, res};
				}),
				RxJsOperators.share(),
			);
			uniqueUrls.pipe(
				RxJsOperators.scan((num) => num + 1, 0),
				RxJsOperators.combineLatestWith(
					results.pipe(
						RxJsOperators.scan((num) => num + 1, 0),
					),
				),
				// RxJsOperators.tap(([started, finished]) => console.log(`${finished} / ${started}`)),
				RxJsOperators.filter(([startedNum, finishedNum]) => startedNum === finishedNum),
			).subscribe(() => urlSubject.complete());
			startUrls.forEach(({url, role}) => urlSubject.next({url: toCanonical(baseUrl, indexName)(url), role}));
			return await Rx.lastValueFrom(results.pipe(RxJsOperators.toArray()));
		}
		const files = await fetchFiles(fetchBases);
		const urlsWithGroups = files.reduce((memo, {url, role, res}) => {
			const existing = memo[url];
			if (existing) {
				const alreadyFound = existing.roles.some((urlRole) => deepEqual(urlRole, role));
				if (alreadyFound) {
					return memo;
				}else {
					return {
						...memo,
						[url]: {res: existing.res, roles: [...existing.roles, role]},
					};
				}
			}else {
				return {
					...memo,
					[url]: {res, roles: [role]},
				};
			}
		}, {} as {[url: string]: {res: typeof files[0]["res"], roles: UrlRole[]}});

		type errors =
			// internal link points to a target that is not found
			"TARGET_NOT_FOUND"
			// hash part of a link points to a place that is not a document
			| "HASH_POINTS_TO_NON_DOCUMENT"
			// hash does not exist on the target page
			| "HASH_TARGET_NOT_FOUND";

		const allPageErrors = (await Promise.all(Object.entries(urlsWithGroups).filter(([, {res}]) => res.data !== null).map(async ([url, {res, roles}]) => {
			console.log(url)
			const allLinksErrors = await Promise.all(
				(await Promise.all(
					roles
					.map((role) => getLinks(toCanonical(baseUrl, indexName)(url))({url, role, res: res as FoundPageFetchResult}))
				))
					.flat()
					.filter((e, i, l) => l.findIndex((e2) => {
						if (e.location.type === "html" && e2.location.type === "html") {
							return getElementLocation(e.location.element) === getElementLocation(e2.location.element);
						}else {
							return deepEqual(e, e2);
						}
					}) === i)
					/*.reduce((memo, link) => {
						return memo;
					}, [] as string[])*/
					.map(async (link): Promise<{type: errors, location: {url: string, location: LinkLocation}}[]> => {
						const getContentType = (res: FileFetchResult) => res.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
						const contentType = getContentType(res);
						if (roles.some((role) => role.type === "document") || contentType === "text/html") {
							if (isInternalLink(baseUrl)(link.url)) {
								const foundTargets = files.filter((file) => file.url === toCanonical(baseUrl, indexName)(link.url));
								if (foundTargets.length === 0 || foundTargets[0].res.data === null) {
									return [{type: "TARGET_NOT_FOUND", location: {url, location: link.location}}];
								}else {
									const hash = new URL(link.url, baseUrl).hash;
									if (hash !== "") {
										// validate hash
										if (foundTargets.some(({role, res}) => role.type === "document" || getContentType(res) === "text/html")) {
											const contents = await fs.readFile(foundTargets[0].res.data);
											const dom = parseJsdom(contents.toString("utf8"), baseUrl);

											const element = dom.window.document.getElementById(hash.substring(1));
											if (element === null) {
												return [{type: "HASH_TARGET_NOT_FOUND", location: {url, location: link.location}}];
											}else {
												return [];
											}
										}else {
											return [{type: "HASH_POINTS_TO_NON_DOCUMENT", location: {url, location: link.location}}];
										}
									}
								}
							}
						}
						return [];
					}));
			console.log("finished", url)
			return allLinksErrors;
		}))).flat(2);
		return allPageErrors;
	}finally {
		await new Promise((res) => app.close(res));
	}
}

