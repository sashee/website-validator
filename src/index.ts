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
import {DeepReadonly} from "ts-essentials";
import {Pool, withPool} from "./worker-runner.js";
import xml2js from "xml2js";

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
	target: string,
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

type ValidationResultType = {
	type: ErrorTypes,
	location: {
		url: string,
		location: LinkLocation,
	}
}

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

const fetchFileGraph = (pool: Pool) => (dir: string, baseUrl: string, indexName: string) => async (fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes) => {
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

		return await recursiveFetchFiles(pool, fetchFile, baseUrl, indexName)([
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

const getLinksFromFileGraph = (files: Awaited<ReturnType<ReturnType<ReturnType<typeof fetchFileGraph>>>>) => {
	return files
		.flatMap(({links}) => links ?? [])
		.map(({url, role, asserts, location}) => ({url, role, asserts, location}));
};

export const validate = (options?: {concurrency?: number}) => (dir: string, baseUrl: string, indexName: string = "index.html") => async (fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes): Promise<Array<ValidationResultType>> => {
	assert((extras.extraUrls ?? []).every((url) => isInternalLink(baseUrl)(url)), "extraUrls must be internal links");
	return withPool(options?.concurrency)(async (pool) => {
		const files = await fetchFileGraph(pool!)(dir, baseUrl, indexName)(fetchBases, extras);
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

		const extraLinksErrors = extraLinks.flatMap((link): Array<ValidationResultType> => {
			const page = urlsWithGroups[toCanonical(baseUrl, indexName)(link.url)];
			if (page.res.data === null) {
				return [{type: "TARGET_NOT_FOUND", location: {url: link.url, location: link.location}}] as const;
			}else {
				const contentType = page.res.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1];
				if (link.role.type === "document" && contentType !== "text/html") {
					return [{type: "LINK_POINTS_TO_NON_DOCUMENT", location: {url: link.url, location: link.location}}] as const;
				}else {
					return [] as const;
				}
				// TODO: check asserts
			}
		});
		const allPageErrors = (await Promise.all(Object.entries(urlsWithGroups).map(async ([url, {res, roles, links}]) => {
			const allDocumentErrors = await pool!.validateFile({baseUrl, url, res: res as FoundPageFetchResult, roles});
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
	});
}

export const compareVersions = (options?: {concurrency?: number}) => (dir: string, baseUrl: string, indexName: string = "index.html") =>
	(fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes) =>
		(originalDir: string, originalBaseUrl: string, originalIndexName: string = "index.html") =>
			async (originalFetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, originalExtras: ExtraTypes): Promise<{
				removedPermanentUrls: DeepReadonly<{url: string, location: LinkLocation}[]>,
				nonForwardCompatibleJsonLinks: DeepReadonly<{url: string, location: LinkLocation}[]>,
				feedGuidsChanged: DeepReadonly<{url: string, feedUrl: string, originalGuid: string, newGuid: string}[]>,
			}> => {
				return withPool(options?.concurrency)(async (pool) => {
					const [originalFileGraph, newFileGraph] = await Promise.all([
						fetchFileGraph(pool!)(originalDir, originalBaseUrl, originalIndexName)(originalFetchBases, originalExtras),
						fetchFileGraph(pool!)(dir, baseUrl, indexName)(fetchBases, extras),
					]);

					const getAllLinks = (files: typeof originalFileGraph) =>
						async (extras: typeof originalExtras) => {
							const extraLinks = await getExtraLinks(extras)
							const allLinks: DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]> = [
								...getLinksFromFileGraph(files),
								...extraLinks,
							];

							return allLinks;
						};
					const getAllPermanentLinks = (files: typeof originalFileGraph) =>
						async (extras: typeof originalExtras) => {
							return (await getAllLinks(files)(extras))
								.filter(({asserts}) => asserts.some(({type}) => type === "permanent"));
						};
					const [removedPermanentUrls, nonForwardCompatibleJsonLinks, feedGuidsChanged] = await Promise.all([
						(async () => {
							const originalPermanentLinks = await getAllPermanentLinks(originalFileGraph)(originalExtras);
							const newPermanentLinks = await getAllPermanentLinks(newFileGraph)(extras);
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
									return pool!.getLinks({baseUrl, url: fetchBase.url, role: fetchBase.role, res: res as FoundPageFetchResult});
								}));
							}
							const linksInJsonsWithNewFilesNewConfig = (await getLinksShallow(dir, baseUrl, indexName)(fetchBases.filter(({role}) => role.type === "json"))).flat();
							const linksInJsonsWithNewFilesOriginalConfig = (await getLinksShallow(dir, baseUrl, indexName)(originalFetchBases.filter(({role}) => role.type === "json"))).flat();

							return linksInJsonsWithNewFilesNewConfig.filter((link) => !linksInJsonsWithNewFilesOriginalConfig.some((l2) => deepEqual(link, l2)));
						})(),
						(async () => {
							const [changedRssItems, changedAtomItems] = await Promise.all([
								(async () => {
									const oldRssFiles = originalFileGraph.filter(({role}) => role.type === "rss");
									const newRssFiles = newFileGraph.filter(({role}) => role.type === "rss");
									const existingRssFiles = newRssFiles.map((newFile) => [newFile, oldRssFiles.find((oldFile) => newFile.url === oldFile.url)] as const).filter(([newFile, oldFile]) => oldFile !== undefined && oldFile.res.data !== null && newFile.res.data !== null);
									const changedRssGuids = await Promise.all(existingRssFiles.map(async ([newFile, oldFile]) => {
										const getRssItems = async (file: string) => {
											const contents = await fs.readFile(file);
											const parsed = await xml2js.parseStringPromise(contents.toString("utf8"), {explicitCharkey: true});
											return (parsed.rss.channel as {item: {link: [{_: string}], guid: [{_: string}]}[]}[]).flatMap((channel) => (channel.item.map((c) => ({link: c.link, guid: c.guid}))).flatMap(({link, guid}) => ({link, guid}))).flatMap(({link, guid}) => {
												return {
													link: link[0]._,
													guid: guid[0]._,
												}
											});
										}
										const originalRssItems = await getRssItems(oldFile!.res.data!);
										const newRssItems = await getRssItems(newFile.res.data!);
										return originalRssItems.flatMap(({link, guid}) => {
											const matchingItem = newRssItems.find((item) => item.link === link);
											if (matchingItem && matchingItem.guid !== guid) {
												return [{
													url: link,
													feedUrl: newFile.url,
													originalGuid: guid,
													newGuid: matchingItem.guid,
												}];
											}else {
												return [];
											}
										})
									}));
									return changedRssGuids.flat();
								})(),
								(async () => {
									const oldAtomFiles = originalFileGraph.filter(({role}) => role.type === "atom");
									const newAtomFiles = newFileGraph.filter(({role}) => role.type === "atom");
									const existingAtomFiles = newAtomFiles.map((newFile) => [newFile, oldAtomFiles.find((oldFile) => newFile.url === oldFile.url)] as const).filter(([newFile, oldFile]) => oldFile !== undefined && oldFile.res.data !== null && newFile.res.data !== null);
									const changedAtomGuids = await Promise.all(existingAtomFiles.map(async ([newFile, oldFile]) => {
										const getAtomItems = async (file: string) => {
											const contents = await fs.readFile(file);
											const parsed = await xml2js.parseStringPromise(contents.toString("utf8"), {explicitCharkey: true});
											return (parsed.feed.entry as {link: [{$: {href: string}}], id: [{_: string}]}[]).flatMap((entry) => ({href: entry.link[0].$.href, id: entry.id[0]._})).map(({href, id}) => {
												return {
													link: href,
													id,
												};
											});
										};
										const originalAtomItems = await getAtomItems(oldFile!.res.data!);
										const newAtomItems = await getAtomItems(newFile.res.data!);
										return originalAtomItems.flatMap(({link, id}) => {
											const matchingItem = newAtomItems.find((item) => item.link === link);
											if (matchingItem && matchingItem.id !== id) {
												return [{
													url: link,
													feedUrl: newFile.url,
													originalGuid: id,
													newGuid: matchingItem.id,
												}];
											}else {
												return [];
											}
										})
									}));
									return changedAtomGuids.flat();

								})(),
							]);
							return [...changedRssItems, ...changedAtomItems];
						})(),
					])

					return {removedPermanentUrls, nonForwardCompatibleJsonLinks, feedGuidsChanged};
				})
			}
