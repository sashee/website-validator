import path from "node:path";
import {deepEqual} from "fast-equals";
import fs from "node:fs/promises";
import mime from "mime";
import { strict as assert } from "node:assert";
import {getUrlsFromSitemap} from "./get-links.js";
import {recursiveFetchFiles} from "./fetch-files.js";
import {DeepReadonly} from "ts-essentials";
import {Pool, withPool} from "./worker-runner.js";
import xml2js from "xml2js";
import { getInterestingPageElements, vnuValidates } from "./utils.js";
import {debuglog} from "node:util";
import Ajv from "ajv";

export const log = debuglog("website-validator");

export type FileFetchResult = {
	url: string,
	headers: {[name: string]: string},
	status: number,
	data: {
		path: string,
		mtime: number,
	} | null,
}

export type FoundPageFetchResult = {
	url: FileFetchResult["url"],
	headers: FileFetchResult["headers"],
	data: NonNullable<FileFetchResult["data"]>,
	status: FileFetchResult["status"],
}

export const getRedirect = async (res: FoundPageFetchResult) => {
	if ([301, 302, 307, 308].includes(res.status)) {
		return Object.entries(res.headers).find(([name]) => name.toLowerCase() === "location")?.[1];
	}else {
		const contentType = Object.entries(res.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
		if (contentType === "text/html") {
			const allMetaTags = (await getInterestingPageElements(res.data)).tagCollections.meta;
			const contentRegex = /^\d+(; url=(?<url>.*))?$/;
			const redirectMetas = allMetaTags.filter((meta) => meta.attrs["http-equiv"] === "refresh" && meta.attrs["content"]?.match(contentRegex)?.groups?.["url"] !== undefined);
			if (redirectMetas.length > 1) {
				throw new Error("More than one redirect metas are not supported...");
			}else if (redirectMetas.length === 1) {
				return new URL(redirectMetas[0].attrs["content"]!.match(contentRegex)!.groups!["url"]!, res.url).href;
			}else {
				return undefined;
			}
		}else {
			return undefined;
		}
	}
}

export const toCanonical = (baseUrl: string, indexName: string) => (url: string) => {
	const urlObj = new URL(url, baseUrl);
	if (urlObj.protocol !== new URL(baseUrl).protocol) {
		return url;
	}else {
		const resolvedPathName = urlObj.pathname.endsWith("/") ? urlObj.pathname + indexName : urlObj.pathname;
		return urlObj.origin + resolvedPathName;
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
type AssertDocument = {type: "document"};

export type Assertion = AssertImage | AssertVideo | AssertFont | AssertImageSize | AssertContentType | AssertPermanent | AssertDocument;

export type EpubcheckError = {
	ID: string,
	severity: string,
	message: string,
	locations: Array<{
		path: string,
		line: number,
		column: number,
	}>,
};

export type VnuReportedError = {
	type: "error",
	subtype?: "fatal",
	message: string,
	extract: string,
	firstLine?: number,
	lastLine: number,
	firstColumn: number,
	lastColumn?: number,
	hiliteStart?: number,
	hiliteLength?: number,
} | {
	type: "info",
	subtype?: "warning",
	message: string,
	extract: string,
	firstLine?: number,
	lastLine: number,
	firstColumn: number,
	lastColumn?: number,
	hiliteStart?: number,
	hiliteLength?: number,
};

export type VnuResult = {
	messages: Array<{
		type: "non-document-error"
		message: string,
	} | VnuReportedError>
}

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
} | {
	type: "redirect",
}

export type LinkErrorTypes = LinkError["type"];

type LinkError = {
	// internal link points to a target that is not found
	type: "TARGET_NOT_FOUND",
	location: {
		url: string,
		location: LinkLocation,
	}
} | {
	// hash part of a link points to a place that is not a document
	type: "HASH_POINTS_TO_NON_DOCUMENT",
	location: {
		url: string,
		location: LinkLocation,
	}
} | {
	// hash does not exist on the target page
	type: "HASH_TARGET_NOT_FOUND",
	location: {
		url: string,
		location: LinkLocation,
	}
} | {
	// link points to a place that is not a document
	type: "LINK_POINTS_TO_NON_DOCUMENT",
	location: {
		url: string,
		location: LinkLocation,
	}
} | {
	// content type not matching
	type: "CONTENT_TYPE_MISMATCH",
	expectedContentTypes: string[],
	actualContentType: string,
	location: {
		url: string,
		location: LinkLocation,
	}
} | {
	// redirect points to another redirect
	type: "REDIRECT_CHAIN",
	targetUrl: string,
	location: {
		url: string,
		location: LinkLocation,
	}
}

type NotFoundError = {
		type: "NOT_FOUND",
		location: {
			url: string,
			location: {
				type: "fetchBase",
				index: number,
			},
		}
	}

type DocumentErrors = {
	type: "JSON_LD_UNPARSEABLE",
	location: {
		url: string,
		location: {outerHTML: string, selector: string},
	},
} | {
	type: "VNU",
	object: VnuReportedError,
	location: {
		url: string,
	},
} | {
	type: "EPUBCHECK",
	object: EpubcheckError,
	location: {
		url: string,
	},
} | {
	type: "PDF_CAN_NOT_BE_PARSED",
	message: string,
	location: {
		url: string,
	},
} | {
	type: "JSON_FILE_UNPARSEABLE",
	location: {
		url: string,
	},
} | {
	type: "XML_FILE_UNPARSEABLE",
	location: {
		url: string,
	},
} | {
	// multiple canonical links are in the page
	type: "MULTIPLE_CANONICAL_LINKS",
	canonicalLinks: Array<{
		outerHTML: string,
		selector: string,
	}>
} | {
	// a page that is not a redirect has a canonical not pointing to itself
	type: "NON_REDIRECT_DIFFERENT_CANONICAL",
	canonicalLink: string,
	location: {
		url: string,
	},
} | {
	// a redirect's canonical link is different than its target
	type: "REDIRECT_DIFFERENT_CANONICAL",
	redirectTarget: string,
	canonicalTarget: string,
} | {
	type: "IMG_SRC_INVALID",
	location: {
		url: string,
		location: {outerHTML: string, selector: string},
	},
	src: {
		url: string,
	} & ({external: false, width: number, height: number } | {external: true}) | undefined,
	srcset: Array<{
		url: string,
		descriptor: {
			density: number,
		} | {width: number},
	} & ({external: false, width: number, height: number } | {external: true})> | undefined,
	sizes: string | undefined,
}

type AdditionalValidatorError = {
	type: "JSON_DOES_NOT_MATCH_SCHEMA",
	result: NonNullable<ReturnType<InstanceType<typeof Ajv>["compile"]>["errors"]>[number],
	schema: Parameters<InstanceType<typeof Ajv>["compile"]>[0],
	url: string,
} | {
	type: "JSON_LD_DOES_NOT_MATCH_SCHEMA",
	filter: Parameters<InstanceType<typeof Ajv>["compile"]>[0],
	result: NonNullable<ReturnType<InstanceType<typeof Ajv>["compile"]>["errors"]>[number],
	schema: Parameters<InstanceType<typeof Ajv>["compile"]>[0],
	url: string,
} | {
	type: "JSON_LD_DOES_NOT_MATCH_OCCURRENCE_REQUIREMENT",
	filter: Parameters<InstanceType<typeof Ajv>["compile"]>[0],
	minOccurrence: number | undefined,
	maxOccurrence: number | undefined,
	actualOccurrence: number,
	url: string,
} | {
	type: "ADDITIONAL_VALIDATOR_MATCH_NUMBER_OUTSIDE_EXPECTED_RANGE",
	minMatches: number | undefined,
	maxMatches: number | undefined,
	actualMatches: number,
	urlPattern: string,
};

export type ValidationResultType = DeepReadonly<LinkError
| DocumentErrors
| NotFoundError
| {
	type: "ROBOTS_TXT_HOST_INVALID",
	expectedHost: string,
	actualHost: string,
}
| {
	type: "ROBOTS_TXT_SITEMAP_INVALID",
	sitemapUrl: string,
}
| {
	type: "SITEMAP_LINK_INVALID",
	sitemapUrl: string,
	url: string,
} | AdditionalValidatorError
>

type ExtraTypes = DeepReadonly<{extraTxtSitemaps?: string[] | undefined, extraXmlSitemaps?: string[] | undefined, extraUrls?: string[] | undefined}>;

const defaultResponseMeta: NonNullable<TargetConfig["responseMeta"]> = (filePath) => {
	return {
		headers: {
			"Content-Type": mime.getType(path.extname(filePath)) ?? "application/octet-stream",
		},
		status: 200,
	}
};

const fetchSingleFile = (baseUrl: string, targetConfig: TargetConfig) => (url: string) => {
	const indexName = targetConfig.indexName ?? "index.html";
	const responseMeta = targetConfig.responseMeta ?? defaultResponseMeta;
	const fetchFile = (() => {
		return async (url: string): Promise<DeepReadonly<FileFetchResult>> => {
			if (!isInternalLink(url)) {
				throw new Error(`Link not internal: ${url}`);
			}
			const fileUrl = toRelativeUrl(baseUrl)(toCanonical(baseUrl, indexName)(url));
			const filePath = path.join(targetConfig.dir, fileUrl);
			try {
				const stat = await fs.stat(filePath);
				return {
					...responseMeta(fileUrl),
					url,
					data: {path: filePath, mtime: stat.mtimeMs},
				}
			}catch(e: any) {
				if (e.code === "ENOENT") {
					return {
						url,
						headers: {},
						status: 404,
						data: null,
					};
				}else {
					throw e;
				}
			}
		}
	})();
	return fetchFile(url);
}

export const fetchFileGraph = (pool: Pool) => (baseUrl: string, targetConfig: TargetConfig) => async (fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes) => {
	const indexName = targetConfig.indexName ?? "index.html";
	const responseMeta = targetConfig.responseMeta ?? defaultResponseMeta;
	const fetchFile = (() => {
		return async (url: string): Promise<DeepReadonly<FileFetchResult>> => {
			if (!isInternalLink(url)) {
				throw new Error(`Link not internal: ${url}`);
			}
			const fileUrl = toRelativeUrl(baseUrl)(toCanonical(baseUrl, indexName)(url));
			const filePath = path.join(targetConfig.dir, fileUrl);
			try {
				const stat = await fs.stat(filePath);
				return {
					...responseMeta(fileUrl),
					url,
					data: {path: filePath, mtime: stat.mtimeMs},
				}
			}catch(e: any) {
				if (e.code === "ENOENT") {
					return {
						url,
						headers: {},
						status: 404,
						data: null,
					};
				}else {
					throw e;
				}
			}
		}
	})();

	return await recursiveFetchFiles(pool, fetchFile, baseUrl, indexName)([
		...fetchBases,
		...(await Promise.all((extras.extraXmlSitemaps ?? []).map(async (xmlSitemap) => getUrlsFromSitemap(xmlSitemap, "xml")))).flat(),
		...(await Promise.all((extras.extraTxtSitemaps ?? []).map(async (txtSitemap) => getUrlsFromSitemap(txtSitemap, "txt")))).flat(),
		...(extras.extraUrls ?? []).map((url) => ({url, role: {type: "asset"}} as const)),
	]);
}

const getExtraLinks = async (extras: ExtraTypes) => {
	return [
		...(await Promise.all((extras.extraXmlSitemaps ?? []).map(async (xmlSitemap, sitemapIndex) => (await getUrlsFromSitemap(xmlSitemap, "xml")).map(({location, ...rest}) => {
		return {
			...rest,
			asserts: [{type: "document"}],
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
				asserts: [{type: "document"}],
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

type TargetConfig = {dir: string, indexName?: string, responseMeta?: (path: string) => {headers: {[name: string]: string}, status: number}};

type JSONAdditionalValidator = {
	type: "json",
	schema: Parameters<InstanceType<typeof Ajv>["compile"]>[0],
}

type RequireAtLeastOne<T, R extends keyof T = keyof T> = Omit<T, R> & {   [ P in R ] : Required<Pick<T, P>> & Partial<Omit<T, P>> }[R];

type JSONLDAdditionalValidator = {
	type: "json-ld",
	filter: Parameters<InstanceType<typeof Ajv>["compile"]>[0],
} & RequireAtLeastOne<{
	minOccurrence: number,
	maxOccurrence: number,
	schema: Parameters<InstanceType<typeof Ajv>["compile"]>[0],
}>;

export type AdditionalValidator = {
	urlPattern: RegExp,
	minMatches?: number,
	maxMatches?: number,
	config: JSONAdditionalValidator | JSONLDAdditionalValidator,
};

export const validate = (options?: {concurrency?: number}) => (baseUrl: string, targetConfig: TargetConfig) => async (fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes, additionalValidators: DeepReadonly<AdditionalValidator[]>): Promise<Array<ValidationResultType>> => {
	assert((extras.extraUrls ?? []).every((url) => isInternalLink(baseUrl)(url)), "extraUrls must be internal links");
	assert(path.isAbsolute(targetConfig.dir), "targetConfig.dir must be an absolute path");
	const indexName = targetConfig.indexName ?? "index.html";
	return withPool(options?.concurrency)(async (pool) => {
		const fetchedFiles = await fetchFileGraph(pool!)(baseUrl, targetConfig)(fetchBases, extras);

		const files = fetchedFiles.reduce((memo, {url, role, res, links}) => {
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
		}, {} as {[url: string]: {res: typeof fetchedFiles[0]["res"], roles: DeepReadonly<UrlRole[]>, links: typeof fetchedFiles[0]["links"]}});

		const extraLinks = await getExtraLinks(extras)
		const allLinks: DeepReadonly<{url: string, asserts: readonly Assertion[], location: LinkLocation}[]> = [
			...(Object.values(files).flatMap(({links}) => links === null ? [] : links.map((link) => ({url: link.url, asserts: link.asserts, location: link.location})))),
			...extraLinks,
		];

		log("fetchedFiles: %O, allLinks: %O, files: %O", fetchedFiles, allLinks, files);
		return (await Promise.all([
			(async () => {
				// not found errors
				return [
					...fetchBases.map(({url}, index) => {
						return {url, index, type: "fetchBase"} as const;
					}),
				].flatMap(({url, index, type}) => {
					const canonical = toCanonical(baseUrl, indexName)(url);
					const file = fetchedFiles.find((file) => file.url === canonical);
					if (file === undefined || file.res.data === null) {
						return [{
							type: "NOT_FOUND",
							location: {
								url,
								location: {
									type,
									index,
								}
							}
						}] as const;
					}else {
						return [];
					}
				});
			})(),
			(async () => {
				// link errors
				return (await Promise.all(allLinks.filter((link) => isInternalLink(baseUrl)(link.url)).map(async (link) => {
					const target = files[toCanonical(baseUrl, indexName)(link.url)]?.res;
					assert(target, "whops; " + JSON.stringify({canonical: toCanonical(baseUrl, indexName)(link.url)}, undefined, 4));
					return pool!.checkLink({baseUrl, indexName, target, link});
				}))).flat(1);
			})(),
			(async () => {
				// file errors
				const vnuCheckFiles = Object.entries(files).flatMap(([, {res}]): Parameters<typeof vnuValidates>[0] => {
					const contentType = Object.entries(res.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
					if (res.data !== null && contentType === "text/html") {
						return [{
							type: "html",
							data: res.data,
						}];
					} else if (res.data !== null && contentType === "text/css") {
						return [{
							type: "css",
							data: res.data,
						}];
					} else if (res.data !== null && contentType === "image/svg+xml") {
						return [{
							type: "svg",
							data: res.data,
						}];
					}else {
						return [];
					}
				});
				const vnuValidationResults = await vnuValidates(vnuCheckFiles);

				const fileValidationResults = await Promise.all(Object.entries(files).map(async ([url, {res, roles, links}]): Promise<{matchedAdditionalValidators: (typeof additionalValidators), errors: ValidationResultType[]}> => {
					if (res.data !== null) {
						assert(links);
						const linkedFiles = Object.fromEntries(links.filter(({url}) => isInternalLink(baseUrl)(url)).map(({url}) => {
							const target = files[toCanonical(baseUrl, indexName)(url)]?.res;
							assert(target);

							return [toCanonical(baseUrl, indexName)(url), target] as const;
						}));
						const vnuResults = vnuValidationResults[res.data.path];
						const matchedAdditionalValidators = additionalValidators.filter(({urlPattern}) => urlPattern.test(toRelativeUrl(baseUrl)(url)));
						return {matchedAdditionalValidators, errors: await pool!.validateFile({baseUrl, indexName, url, res: res as FoundPageFetchResult, roles, linkedFiles, vnuResults, additionalValidators: matchedAdditionalValidators.map(({config}) => config)})};
					}else {
						return {matchedAdditionalValidators: [], errors: []};
					}
				}));
				return [
					...additionalValidators.map((additionalValidator) => {
						return [additionalValidator, fileValidationResults.reduce((memo, {matchedAdditionalValidators}) => {
							return memo + (matchedAdditionalValidators.includes(additionalValidator) ? 1 : 0);
						}, 0)] as const;
					}).flatMap(([additionalValidator, num]) => {
						if (num >= (additionalValidator.minMatches ?? 0) && num <= (additionalValidator.maxMatches ?? Number.MAX_SAFE_INTEGER)) {
							return [];
						}else {
							return [{
								type: "ADDITIONAL_VALIDATOR_MATCH_NUMBER_OUTSIDE_EXPECTED_RANGE",
								minMatches: additionalValidator.minMatches,
								maxMatches: additionalValidator.maxMatches,
								actualMatches: num,
								urlPattern: additionalValidator.urlPattern.toString(),
							}] as const;
						}
					}),
					...fileValidationResults.map(({errors}) => errors).flat(2),
				];
			})(),
		])).flat(1);
	});
}

export const compareVersions = (options?: {concurrency?: number}) => (baseUrl: string, targetConfig: TargetConfig) =>
	(fetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, extras: ExtraTypes) =>
		(originalBaseUrl: string, originalTargetConfig: TargetConfig) =>
			async (originalFetchBases: DeepReadonly<{url: string, role: UrlRole}[]>, originalExtras: ExtraTypes): Promise<{
				removedPermanentUrls: DeepReadonly<{url: string, location: LinkLocation}[]>,
				nonForwardCompatibleJsonLinks: DeepReadonly<{url: string, location: LinkLocation}[]>,
				feedGuidsChanged: DeepReadonly<{url: string, feedUrl: string, originalGuid: string, newGuid: string}[]>,
			}> => {
				assert(path.isAbsolute(targetConfig.dir), "targetConfig.dir must be an absolute path");
				assert(path.isAbsolute(originalTargetConfig.dir), "originalTargetConfig.dir must be an absolute path");
				return withPool(options?.concurrency)(async (pool) => {
					const [originalFileGraph, newFileGraph] = await Promise.all([
						fetchFileGraph(pool!)(originalBaseUrl, originalTargetConfig)(originalFetchBases, originalExtras),
						fetchFileGraph(pool!)(baseUrl, targetConfig)(fetchBases, extras),
					]);

					const getAllLinks = (files: typeof originalFileGraph) =>
						async (extras: typeof originalExtras) => {
							const extraLinks = await getExtraLinks(extras)

							const getLinksFromFileGraph = (files: Awaited<ReturnType<ReturnType<ReturnType<typeof fetchFileGraph>>>>) => {
								return files
									.flatMap(({links}) => links ?? [])
									.map(({url, role, asserts, location}) => ({url, role, asserts, location}));
							};

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
							const getLinksShallow = (baseUrl: string, targetConfig: TargetConfig) => async (fetchBases: typeof originalFetchBases) => {
								return Promise.all(fetchBases.map(async (fetchBase) => {
									const res = await fetchSingleFile(baseUrl, targetConfig)(fetchBase.url);
									if (res.data === null) {
										return [];
									}
									return pool!.getLinks({url: fetchBase.url, role: fetchBase.role, res: res as FoundPageFetchResult});
								}));
							}
							const linksInJsonsWithNewFilesNewConfig = (await getLinksShallow(baseUrl, targetConfig)(fetchBases.filter(({role}) => role.type === "json"))).flat();
							const linksInJsonsWithNewFilesOriginalConfig = (await getLinksShallow(baseUrl, targetConfig)(originalFetchBases.filter(({role}) => role.type === "json"))).flat();

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
										const originalRssItems = await getRssItems(oldFile!.res.data!.path);
										const newRssItems = await getRssItems(newFile.res.data!.path);
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
										const originalAtomItems = await getAtomItems(oldFile!.res.data!.path);
										const newAtomItems = await getAtomItems(newFile.res.data!.path);
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

