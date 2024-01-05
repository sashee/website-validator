import {startStaticFileServer} from "./utils.js";
import getPort from "get-port";
import {JSDOM} from "jsdom";
import Rx from "rxjs";
import RxJsOperators from "rxjs/operators";
import crypto from "crypto";
import path from "node:path";
import {deepEqual} from "fast-equals";
import fs from "node:fs/promises";
import mime from "mime";
import { strict as assert } from "node:assert";
import Piscina from "piscina";
import url from "url";
import {getLinks} from "./get-links.js";
import os from "node:os";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const piscina = new Piscina({
  filename: path.resolve(__dirname, "get-links.js"),
	maxThreads: os.availableParallelism(),
});

export type FileFetchResult = {
	headers: [string, string][],
	data: string | null,
}

export type FoundPageFetchResult = {
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

export type UrlRole = {
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

export type Assertion = AssertImage | AssertVideo | AssertFont | AssertImageSize | AssertContentType | AssertPermanent;

export type LinkLocation = {
	type: "html",
	element: {
		outerHTML: string,
		selector: string,
	},
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


type ErrorTypes =
	// internal link points to a target that is not found
	"TARGET_NOT_FOUND"
	// hash part of a link points to a place that is not a document
	| "HASH_POINTS_TO_NON_DOCUMENT"
	// hash does not exist on the target page
	| "HASH_TARGET_NOT_FOUND";

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
						const links = await (piscina.run({baseUrl: toCanonical(baseUrl, indexName)(url), url, role, res: res as FoundPageFetchResult}, {name: getLinks.name}) as ReturnType<typeof getLinks>);
						const discoveredUrls = links.map((link) => ({url: toCanonical(url, indexName)(link.url), role: link.role}));
						discoveredUrls.filter(({url}) => isInternalLink(baseUrl)(url)).forEach(({url, role}) => urlSubject.next({url, role}));
						return {url, role, res: res as FoundPageFetchResult, links};
					}else {
						return {url, role, res, links: null};
					}
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
				RxJsOperators.tap(([started, finished]) => console.log(`${finished} / ${started}`)),
				RxJsOperators.filter(([startedNum, finishedNum]) => startedNum === finishedNum),
			).subscribe(() => urlSubject.complete());
			startUrls.forEach(({url, role}) => urlSubject.next({url: toCanonical(baseUrl, indexName)(url), role}));
			return await Rx.lastValueFrom(results.pipe(RxJsOperators.toArray()));
		}
		const files = await fetchFiles(fetchBases);
		const allLinks = files
			.flatMap(({links}) => links ?? [])
			.map(({url, role, asserts}) => ({url, role, asserts}));

		const linksPointingToPages = allLinks.reduce((memo, link) => {
			const canonical = toCanonical(baseUrl, indexName)(link.url);
			if (memo[canonical]) {
				if (memo[canonical].some((e) => deepEqual(e, link))) {
					return memo;
				}else {
					memo[canonical].push(link);
					return memo;
				}
			}else {
				memo[canonical] = [link];
				return memo;
			}
		}, {} as {[canonicalUrl: string]: typeof allLinks});
		const checkLinks = async (links: typeof allLinks): Promise<{type: ErrorTypes, link: typeof allLinks[0]}[]> => {
			if (links.length === 0) {
				return [];
			}
			const canonical = toCanonical(baseUrl, indexName)(links[0].url);
			assert(links.every(({url}) => toCanonical(baseUrl, indexName)(url) === canonical), `Not all links point to the same page: ${JSON.stringify(links.map(({url}) => url + " => " + toCanonical(baseUrl, indexName)(url)), undefined, 4)}`);
			const res = (() => {
				const found = files.find((file) => file.url === canonical);
				assert(found, `Files must contain the canonical link, but it's missing. canonical=${canonical}`);
				return found.res;
			})();
			const getContentType = (res: FileFetchResult) => res.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
			const contentType = getContentType(res);
			const dom = await (async () => {
				if (links.some(({url}) => new URL(url, baseUrl).hash !== "")) {
					assert(res.data, "res.data must not be null if there are fragment links");
					const contents = await fs.readFile(res.data);
					return new JSDOM(contents.toString("utf8"), {url: baseUrl});
				}else {
					return null;
				}
			})();
			return links.flatMap((link): {type: ErrorTypes, link: typeof link}[] => {
				if (link.role.type === "document" || contentType === "text/html") {
					if (isInternalLink(baseUrl)(link.url)) {
						if (res.data === null) {
							return [{type: "TARGET_NOT_FOUND", link}];
						}else {
							const hash = new URL(link.url, baseUrl).hash;
							if (hash !== "") {
								// validate hash
								assert(dom, "dom must be parsed if there are fragment links");
								const element = dom.window.document.getElementById(hash.substring(1));
								if (element === null) {
									return [{type: "HASH_TARGET_NOT_FOUND", link}];
								}else {
									return [];
								}
							}else {
								return [];
							}
						}
					}else {
						return [];
					}
				}else {
					if (new URL(link.url, baseUrl).hash !== "") {
						return [{type: "HASH_POINTS_TO_NON_DOCUMENT", link}];
					}else {
						return [];
					}
				}
			})
		}
		const allLinksWithErrors = Object.fromEntries((await Promise.all(Object.entries(linksPointingToPages).map(async ([canonicalUrl, links]) => {
			return [canonicalUrl, await checkLinks(links.filter(({url}) => isInternalLink(baseUrl)(url)))] as const;
		}))));
		const urlsWithGroups = files.reduce((memo, {url, role, res, links}) => {
			const existing = memo[url];
			if (memo[url]) {
				memo[url] = {
					...existing,
					roles: [...existing.roles, role].filter((e, i, l) => l.findIndex((e2) => deepEqual(e, e2)) === i),
					links: [...(existing.links ?? []), ...(links ?? [])].filter((e, i, l) => l.findIndex((e2) => deepEqual(e, e2)) === i),
				}
				return memo;
			}else {
				memo[url] = {res, roles: [role], links};
				return memo;
			}
		}, {} as {[url: string]: {res: typeof files[0]["res"], roles: UrlRole[], links: typeof files[0]["links"]}});

		const allPageErrors = (await Promise.all(Object.entries(urlsWithGroups).filter(([, {res}]) => res.data !== null).map(async ([url, {res, roles, links}]) => {
			const allLinksErrors = await Promise.all(
				(links ?? [])
					.filter((e, i, l) => l.findIndex((e2) => {
						if (e.location.type === "html" && e2.location.type === "html") {
							return e.location.element.selector === e2.location.element.selector;
						}else {
							return deepEqual(e, e2);
						}
					}) === i)
					.map(async (link): Promise<{type: ErrorTypes, location: {url: string, location: LinkLocation}}[]> => {
						const foundErrors = allLinksWithErrors[toCanonical(baseUrl, indexName)(link.url)]?.filter(({link: linkWithError}) => {
							return deepEqual(linkWithError, {url: link.url, role: link.role, asserts: link.asserts} as typeof linkWithError)
						});
						assert(foundErrors);
						return foundErrors.map(({type}) => {
							return {
								type,
								location: {
									url,
									location: link.location,
								},
							};
						});
				}));
			return allLinksErrors;
		}))).flat(2);
		return allPageErrors;
	}finally {
		await new Promise((res) => app.close(res));
	}
}

