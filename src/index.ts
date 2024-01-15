import {startStaticFileServer} from "./utils.js";
import getPort from "get-port";
import {JSDOM} from "jsdom";
import crypto from "crypto";
import path from "node:path";
import {deepEqual} from "fast-equals";
import fs from "node:fs/promises";
import mime from "mime";
import { strict as assert } from "node:assert";
import url from "url";
import {getUrlsFromSitemap} from "./get-links.js";
import {recursiveFetchFiles} from "./fetch-files.js";
import util from "node:util";
import {DeepReadonly} from "ts-essentials";
import {pool} from "./worker-runner.js";
import {validateFile, getLinks} from "./worker.js";

export type FileFetchResult = {
	headers: [string, string][],
	data: string | null,
}

export type FoundPageFetchResult = {
	headers: FileFetchResult["headers"],
	data: NonNullable<FileFetchResult["data"]>,
}

export const sha = (x: crypto.BinaryLike) => crypto.createHash("sha256").update(x).digest("hex");

export const toCanonical = (baseUrl: string, indexName: string) => (url: string) => {
	const urlObj = new URL(url, baseUrl);
	if (urlObj.protocol !== new URL(baseUrl).protocol) {
		return url;
	}else {
		const resolvedPathName = urlObj.pathname.endsWith("/") ? urlObj.pathname + indexName : urlObj.pathname;
		return urlObj.origin + resolvedPathName + urlObj.search;
	}
}

export const isInternalLink = (baseUrl: string) => (url: string) => {
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
	sitemaplocation: {
		url: string,
	} | {
		extrasitemapIndex: number
	},
	index: number,
} | {
	type: "sitemapxml",
	sitemaplocation: {
		url: string,
	} | {
		extrasitemapIndex: number
	},
	urlsetIndex: number,
	urlIndex: number,
} | {
	type: "rss",
	rssurl: string,
	channelIndex: number,
	linkIndex: number,
} | {
	type: "atom",
	atomurl: string,
	entryIndex: number,
	linkIndex: number,
} | {
	type: "json",
	jsonurl: string,
	jmespath: string,
	index: number,
} | {
	type: "css",
	position: string,
} | {
	type: "extraurl",
	index: number,
}

type ErrorTypes =
	// internal link points to a target that is not found
	"TARGET_NOT_FOUND"
	// hash part of a link points to a place that is not a document
	| "HASH_POINTS_TO_NON_DOCUMENT"
	// hash does not exist on the target page
	| "HASH_TARGET_NOT_FOUND"
	// link points to a place that is not a document
	| "LINK_POINTS_TO_NON_DOCUMENT"
	// json/ld block is not parseable
	| "JSON_LD_UNPARSEABLE";

type ExtraTypes = DeepReadonly<{extraTxtSitemaps?: string[] | undefined, extraXmlSitemaps?: string[] | undefined, extraUrls?: string[] | undefined}>;

const fetchSingleFile = (dir: string, baseUrl: string, indexName: string) => (url: string) => {
	const fetchFile = (() => {
		return async (url: string): Promise<DeepReadonly<FileFetchResult>> => {
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
	return fetchFile(url);
}

const fetchFileGraph = (dir: string, baseUrl: string, indexName: string) => async (fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes) => {
	const port = await getPort();
	const app = await startStaticFileServer(dir, port, indexName);
	try {
		const fetchFile = (() => {
			return async (url: string): Promise<DeepReadonly<FileFetchResult>> => {
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

		return await recursiveFetchFiles(fetchFile, baseUrl, indexName)([
			...fetchBases,
			...(await Promise.all((extras.extraXmlSitemaps ?? []).map(async (xmlSitemap) => getUrlsFromSitemap(xmlSitemap, "xml")))).flat(),
			...(await Promise.all((extras.extraTxtSitemaps ?? []).map(async (txtSitemap) => getUrlsFromSitemap(txtSitemap, "txt")))).flat(),
			...(extras.extraUrls ?? []).map((url) => ({url, role: {type: "asset"}} as const)),
		]);
	}finally {
		await new Promise((res) => app.close(res));
	}
}

const getExtraLinks = async (extras: ExtraTypes) => {
	return [
		...(await Promise.all((extras.extraXmlSitemaps ?? []).map(async (xmlSitemap, sitemapIndex) => (await getUrlsFromSitemap(xmlSitemap, "xml")).map(({location, ...rest}) => {
		return {
			...rest,
			location: {
				...location,
				sitemaplocation: {
					extrasitemapIndex: sitemapIndex,
				},
			},
		} as const;
	})))).flat(),
		...(await Promise.all((extras.extraTxtSitemaps ?? []).map(async (txtSitemap, sitemapIndex) => (await getUrlsFromSitemap(txtSitemap, "txt")).map(({location, ...rest}) => {
			return {
				...rest,
				location: {
					...location,
					sitemaplocation: {
						extrasitemapIndex: sitemapIndex,
					},
				},
			} as const;
		})))).flat(),
		...(extras.extraUrls ?? []).map((url, index) => ({url, role: {type: "asset"}, asserts: [], location: {type: "extraurl", index}} as const)),
	];
}

const getLinksFromFileGraph = (files: Awaited<ReturnType<ReturnType<typeof fetchFileGraph>>>) => {
	return files
		.flatMap(({links}) => links ?? [])
		.map(({url, role, asserts, location}) => ({url, role, asserts, location}));
};

export const validate = (dir: string, baseUrl: string, indexName: string = "index.html") => async (fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes) => {
	assert((extras.extraUrls ?? []).every((url) => isInternalLink(baseUrl)(url)), "extraUrls must be internal links");
	const files = await fetchFileGraph(dir, baseUrl, indexName)(fetchBases, extras);
	const extraLinks = await getExtraLinks(extras)
	const allLinks: DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]> = [
		...getLinksFromFileGraph(files),
		...extraLinks,
	];

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
	}, {} as {[canonicalUrl: string]: typeof allLinks[0][]});
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
		const getContentType = (res: DeepReadonly<FileFetchResult>) => res.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
		const contentType = getContentType(res);
		const dom = await (async () => {
			if (res.data && links.some(({url}) => new URL(url, baseUrl).hash !== "")) {
				const contents = await fs.readFile(res.data);
				return new JSDOM(contents.toString("utf8"), {url: baseUrl});
			}else {
				return null;
			}
		})();
		return links.flatMap((link): {type: ErrorTypes, link: typeof link}[] => {
			if (isInternalLink(baseUrl)(link.url)) {
				if (res.data === null) {
					return [{type: "TARGET_NOT_FOUND", link}];
				}else {
					if (link.role.type === "document" || contentType === "text/html") {
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
					}else {
						if (new URL(link.url, baseUrl).hash !== "") {
							return [{type: "HASH_POINTS_TO_NON_DOCUMENT", link}];
						}else {
							return [];
						}
					}
				}
			}else {
				return [];
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
			memo[url] = {res, roles: [role], links} as const;
			return memo;
		}
	}, {} as {[url: string]: {res: typeof files[0]["res"], roles: DeepReadonly<UrlRole[]>, links: typeof files[0]["links"]}});

	const extraLinksErrors = extraLinks.flatMap((link) => {
		const page = urlsWithGroups[toCanonical(baseUrl, indexName)(link.url)];
		if (page.res.data === null) {
			return [{type: "TARGET_NOT_FOUND", location: {url: link.url, location: link.location}}];
		}else {
			const contentType = page.res.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
			if (link.role.type === "document" && contentType !== "text/html") {
				return [{type: "LINK_POINTS_TO_NON_DOCUMENT", location: {url: link.url, location: link.location}}];
			}else {
				return [];
			}
			// TODO: check asserts
		}
	});
	const allPageErrors = (await Promise.all(Object.entries(urlsWithGroups).map(async ([url, {res, roles, links}]) => {
		const allDocumentErrors = await (pool.run({baseUrl, url, res, roles}, {name: validateFile.name}) as ReturnType<typeof validateFile>);
		const allLinksErrors = await Promise.all(
			(links ?? [])
				.filter((e, i, l) => l.findIndex((e2) => {
					return deepEqual(e, e2);
				}) === i)
				.map(async (link): Promise<{type: ErrorTypes, location: {url: string, location: LinkLocation}}[]> => {
					const foundErrors = allLinksWithErrors[toCanonical(baseUrl, indexName)(link.url)]?.filter(({link: linkWithError}) => {
						return deepEqual(linkWithError, link)
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
		return [...allLinksErrors, ...allDocumentErrors];
	}))).flat(2);
	return [...allPageErrors, ...extraLinksErrors];
}

export const compareVersions = (dir: string, baseUrl: string, indexName: string = "index.html") =>
	(fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes) =>
		(originalDir: string, originalBaseUrl: string, originalIndexName: string = "index.html") =>
			async (originalFetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, originalExtras: ExtraTypes): Promise<{
				removedPermanentUrls: DeepReadonly<{url: string, location: LinkLocation}[]>,
				nonForwardCompatibleJsonLinks: DeepReadonly<{url: string, location: LinkLocation}[]>,
			}> => {
				const getAllLinks = (dir: string, baseUrl: string, indexName: string) =>
					async (fetchBases: typeof originalFetchBases, extras: typeof originalExtras) => {
						const files = await fetchFileGraph(dir, baseUrl, indexName)(fetchBases, extras);
						const extraLinks = await getExtraLinks(extras)
						const allLinks: DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]> = [
							...getLinksFromFileGraph(files),
							...extraLinks,
						];

						return allLinks;
					};
				const getAllPermanentLinks = (dir: string, baseUrl: string, indexName: string) =>
					async (fetchBases: typeof originalFetchBases, extras: typeof originalExtras) => {
						return (await getAllLinks(dir, baseUrl, indexName)(fetchBases, extras))
							.filter(({asserts}) => asserts.some(({type}) => type === "permanent"));
					};
				const [removedPermanentUrls, nonForwardCompatibleJsonLinks] = await Promise.all([
					(async () => {
						const originalPermanentLinks = await getAllPermanentLinks(originalDir, originalBaseUrl, originalIndexName)(originalFetchBases, originalExtras);
						const newPermanentLinks = await getAllPermanentLinks(dir, baseUrl, indexName)(fetchBases, extras);
						return  originalPermanentLinks.filter((link) => {
							return !newPermanentLinks.some(({url}) => link.url === url);
						});
					})(),
					(async () => {
						const getLinksShallow = (dir: string, baseUrl: string, indexName: string) => async (fetchBases: typeof originalFetchBases) => {
							return Promise.all(fetchBases.map(async (fetchBase) => {
								const res = await fetchSingleFile(dir, baseUrl, indexName)(fetchBase.url);
								if (res.data === null) {
									return [];
								}
								return (pool.run({baseUrl, url: fetchBase.url, role: fetchBase.role, res: res as FoundPageFetchResult}, {name: getLinks.name}) as ReturnType<typeof getLinks>);
							}));
						}
						const linksInJsonsWithNewFilesNewConfig = (await getLinksShallow(dir, baseUrl, indexName)(fetchBases.filter(({role}) => role.type === "json"))).flat();
						const linksInJsonsWithNewFilesOriginalConfig = (await getLinksShallow(dir, baseUrl, indexName)(originalFetchBases.filter(({role}) => role.type === "json"))).flat();

						return linksInJsonsWithNewFilesNewConfig.filter((link) => !linksInJsonsWithNewFilesOriginalConfig.some((l2) => deepEqual(link, l2)));
					})(),
				])

				return {removedPermanentUrls, nonForwardCompatibleJsonLinks};
			}

