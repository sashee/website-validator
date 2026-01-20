import type {DeepReadonly} from "ts-essentials";
import type {FileFetchResult, FoundPageFetchResult, UrlRole, ValidationResultType, VnuReportedError, AdditionalValidator} from "./index.ts";
import {getRedirect, isInternalLink, toCanonical} from "./index.ts";
import {validateEpub, validatePdf, getImageDimensions, getInterestingPageElements} from "./utils.ts";
import fs from "node:fs/promises";
import _robotsParser from "robots-parser";
import { getUrlsFromSitemap } from "./get-links.ts";
import path from "node:path";
import xml2js from "xml2js";
import { strict as assert } from "node:assert";
import {parseSrcset} from "srcset";
import {Ajv} from "ajv";
import addFormats from "ajv-formats"

// can be removed when robots-parser is converted to ESM
const robotsParser = _robotsParser as any as typeof _robotsParser.default;

const ajv = new Ajv();
addFormats.default(ajv);

export const validateFile = async (baseUrl: string, indexName: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>, linkedFiles: {[url: string]: FileFetchResult}, vnuResults: VnuReportedError[], additionalValidators: DeepReadonly<AdditionalValidator["config"][]>): Promise<ValidationResultType[]> => {
	const contentType = Object.entries(res.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
	const redirect = await getRedirect(res);
	return (await Promise.all([
		(async () => {
			if (redirect !== undefined && contentType === "text/html") {
				const allLinks = (await getInterestingPageElements(res.data)).tagCollections.link;
				const allCanonicals = allLinks.filter((link) => link.attrs["rel"] === "canonical");
				if (allCanonicals.length > 0) {
					const canonicalHref = (() => {
						const href = allCanonicals[0].attrs["href"];
						if (href) {
							if (isInternalLink(baseUrl)(href)) {
								return toCanonical(baseUrl, indexName)(href) 
							}else {
								return href;
							}
						}else {
							return "";
						}
					})();
					const canonicalRedirect = isInternalLink(baseUrl)(redirect) ? toCanonical(baseUrl, indexName)(redirect) : redirect;
					if (canonicalHref !== canonicalRedirect) {
						return [{
							type: "REDIRECT_DIFFERENT_CANONICAL",
							redirectTarget: redirect,
							canonicalTarget: allCanonicals[0].attrs["href"] ?? "",
						}] as const;
					}else {
						return [];
					}
				}else {
					return [];
				}
			}else {
				return [];
			}
		})(),
		(async () => {
			if (contentType === "text/html") {
				return (await Promise.all([
					(async () => {
						assert(vnuResults);
						return (vnuResults).map((object) => {
							return {
								type: "VNU",
								object,
								location: {
									url,
								}
							} as const;
						});
					})(),
					(async () => {
						const allLinks = (await getInterestingPageElements(res.data)).tagCollections.link;
						const allCanonicals = allLinks.filter((link) => link.attrs["rel"] === "canonical");
						if (allCanonicals.length > 1) {
							return [{
								type: "MULTIPLE_CANONICAL_LINKS",
								canonicalLinks: allCanonicals.map(({outerHTML, selector}) => ({
									outerHTML,
									selector,
								})),
							}] as const;
						}else if (redirect === undefined && allCanonicals.length === 1) {
							const canonicalHref = allCanonicals[0].attrs["href"] ? toCanonical(baseUrl, indexName)(allCanonicals[0].attrs["href"]) : "";
							if (canonicalHref !== url) {
								return [{
									type: "NON_REDIRECT_DIFFERENT_CANONICAL",
									canonicalLink: allCanonicals[0].attrs["href"] ?? "",
									location: {
										url: url,
									},
								}] as const;
							}else {
								return [];
							}
						}else {
							return [];
						}
					})(),
					(async () => {
						const allJSONLDs = (await getInterestingPageElements(res.data)).tagCollections.script.filter(({attrs}) => attrs["type"] === "application/ld+json");
						return allJSONLDs.flatMap((jsonLd) => {
							try {
								JSON.parse(jsonLd.innerHTML);
								return [] as const;
							}catch {
								return [{type: "JSON_LD_UNPARSEABLE", location: {url, location: {outerHTML: jsonLd.outerHTML, selector: jsonLd.selector}}}] as const;
							}
						});
					})(),
					(async () => {
						const allImgs = (await getInterestingPageElements(res.data)).tagCollections.img;
						return (await Promise.all(allImgs.map(async (img) => {
							const src = await (async () => {
								const srcAttr = img.attrs["src"];
								if (srcAttr) {
									if (isInternalLink(baseUrl)(srcAttr)) {
										const res = linkedFiles[toCanonical(baseUrl, indexName)(srcAttr)];
										assert(res);
										assert(res.data);
										const dimensions = await getImageDimensions(res.data);
										assert(dimensions.width !== undefined);
										assert(dimensions.height !== undefined);
										return {
											url: srcAttr,
											width: dimensions.width,
											height: dimensions.height,
											external: false,
										} as const;
									}else {
										return {
											url: srcAttr,
											external: true,
										} as const;
									}
								}else {
									return undefined;
								}
							})();
							const srcset = await (async () => {
								if (img.attrs["srcset"]) {
									const srcset = parseSrcset(img.attrs["srcset"]);
									return Promise.all(srcset.map(async ({url, density, width}) => {
										if (isInternalLink(baseUrl)(url)) {
											const res = linkedFiles[toCanonical(baseUrl, indexName)(url)];
											assert(res, JSON.stringify({url, linkedFiles}, undefined, 4));
											assert(res.data);
											const dimensions = await getImageDimensions(res.data);
											assert(dimensions.width !== undefined);
											assert(dimensions.height !== undefined);
											return {
												url,
												width: dimensions.width,
												height: dimensions.height,
												external: false,
												descriptor: density !== undefined ? {density} : {width: width!},
											} as const;
										}else {
											return {
												url,
												external: true,
												descriptor: density !== undefined ? {density} : {width: width!},
											} as const;
										}
									}));
								}else {
									return undefined;
								}
							})();
							const srcSetWidthsIncorrect = srcset?.some(({width, descriptor}) => descriptor.width !== undefined && width !== descriptor.width);
							const srcSetDensitiesIncorrect = (() => {
								const mergedSrcSets = [
									...(srcset ?? []).filter(({descriptor}) => descriptor.density !== undefined),
									...(src !== undefined ? [{...src, descriptor: {density: 1}}]: []),
								].filter(({external}) => !external);
								const maxDensity = Math.max(...mergedSrcSets.map(({descriptor}) => {
									assert(descriptor.density !== undefined);
									return descriptor.density;
								}));
								if (maxDensity === Number.NEGATIVE_INFINITY) {
									return false;
								}else {
									const maxWidth = mergedSrcSets.find(({descriptor}) => descriptor.density === maxDensity)?.width;
									assert(maxWidth);
									return mergedSrcSets.some(({width, descriptor}) => {
										assert(descriptor.density !== undefined);
										assert(width !== undefined);
										return Math.abs(width - (maxWidth * descriptor.density / maxDensity)) > 1;
									});
								}
							})();
							const aspectRatiosIncorrect = (() => {
								const mergedSrcSets = [
									...(srcset ?? []),
									...(src !== undefined ? [src]: []),
								].filter(({external}) => !external).map(({width, height}) => ({width, height}));
								return mergedSrcSets.length !== 0 && mergedSrcSets.some(({width, height}, _i, l) => {
									assert(width !== undefined);
									assert(height !== undefined);
									assert(l[0].width !== undefined);
									assert(l[0].height !== undefined);
									const res = Math.abs(l[0].height - height * l[0].width / width) > 2;
									return res;
								});
							})();
							const sizesIncorrect = (() => {
								const sizes = img.attrs["sizes"];
								const sizePattern = /^(?<num>\d+)px$/;
								if (srcset?.length! > 0 && sizes !== undefined && sizes.includes(" ") === false && sizes.match(sizePattern)) {
									const num = parseInt(sizes.match(sizePattern)!.groups!["num"]);
									return !(srcset ?? []).some(({width}) => width === num);
								}else {
									return false;
								}
							})();
							if (srcSetWidthsIncorrect || srcSetDensitiesIncorrect || aspectRatiosIncorrect || sizesIncorrect) {
								return [{
									type: "IMG_SRC_INVALID",
									location: {
										url: url,
										location: {outerHTML: img.outerHTML, selector: img.selector},
									},
									src,
									srcset,
									sizes: img.attrs["sizes"],
								}] as const;
							}
							return [];
						}))).flat(1);
					})(),
				])).flat(1);
			}else if (contentType === "application/epub+zip") {
				const results = await validateEpub(res.data);
				return results.map((msg) => ({
					type: "EPUBCHECK",
					location: {url},
					object: msg,
				}) as const);
			}else if (contentType === "application/pdf") {
				const results = await validatePdf(res.data);
				return results.map((msg) => ({
					type: "PDF_CAN_NOT_BE_PARSED",
					location: {url},
					message: msg,
				}) as const);
			}else if (contentType === "application/json" || (contentType !== undefined && contentType.startsWith("application/") && contentType.endsWith("+json"))) {
				const contents = await fs.readFile(res.data.path);
				try {
					JSON.parse(contents.toString("utf8"));
					return [];
				}catch(e) {
					return [{
						type: "JSON_FILE_UNPARSEABLE",
						location: {url},
					}] as const;
				}
			}else if (contentType === "text/css") {
				const cssErrors = await (async () => {
					assert(vnuResults);
					return (vnuResults).map((object) => {
						return {
							type: "VNU",
							object,
							location: {
								url,
							}
						} as const;
					});
				})();
				return [...cssErrors];
			}else if (contentType === "image/svg+xml") {
				const svgErrors = await (async () => {
					assert(vnuResults);
					return (vnuResults).map((object) => {
						return {
							type: "VNU",
							object,
							location: {
								url,
							}
						} as const;
					});
				})();
				return [...svgErrors];
			}else if (roles.some(({type}) => type === "robotstxt")) {
				const contents = await fs.readFile(res.data.path);
				const robots = robotsParser(url, contents.toString("utf8"));
				const hostErrors = (() => {
					const host = robots.getPreferredHost();
					const baseUrlHost = new URL(baseUrl).host;
					if (host !== null && host !== baseUrlHost) {
						return [{
							type: "ROBOTS_TXT_HOST_INVALID",
							expectedHost: baseUrlHost,
							actualHost: host,
						}] as const;
					}else {
						return [];
					}
				})();
				const sitemapErrors = (() => {
					return robots.getSitemaps().flatMap((sitemap) => {
						if (isInternalLink(baseUrl)(sitemap) === false) {
							return [{
								type: "ROBOTS_TXT_SITEMAP_INVALID",
								sitemapUrl: sitemap,
							}] as const;
						}else {
							return [];
						}
					});
				})();
				return [...hostErrors, ...sitemapErrors];
			}else if (roles.some(({type}) => type === "sitemap")) {
				const contents = await fs.readFile(res.data.path);
				const extension = path.extname(new URL(url).pathname);
				const urls = await getUrlsFromSitemap(contents.toString("utf8"), extension === ".txt" ? "txt" : "xml");
				const sitemapUrl = url;
				return urls.flatMap(({url}) => {
					if (isInternalLink(baseUrl)(url) === false) {
						return [{
							type: "SITEMAP_LINK_INVALID",
							sitemapUrl,
							url,
						}] as const;
					}else {
						return [];
					}
				})
			}else if (contentType === "application/xml" || (contentType !== undefined && contentType.endsWith("+xml"))) {
				const contents = await fs.readFile(res.data.path);
				try {
					await xml2js.parseStringPromise(contents);
					return [];
				}catch(e) {
					return [{
						type: "XML_FILE_UNPARSEABLE",
						location: {url},
					}] as const;
				}
			}else {
				return [];
			}
		})(),
		(async () => {
			const contents = await fs.readFile(res.data.path);
			return (await Promise.all(additionalValidators.map(async (additionalValidator) => {
				assert(["json", "json-ld"].includes(additionalValidator.type));
				if (additionalValidator.type === "json") {
					const validate = ajv.compile(additionalValidator.schema);
					const validationResult = await validate(JSON.parse(contents.toString("utf8")));
					if (!validationResult) {
						return validate.errors!.map((obj) => ({
							type: "JSON_DOES_NOT_MATCH_SCHEMA",
							result: obj,
							schema: additionalValidator.schema,
							url,
						} as const));
					}else {
						return [];
					}
				}else if (additionalValidator.type === "json-ld") {
					const allJSONLDs = (await getInterestingPageElements(res.data)).tagCollections.script.filter(({attrs}) => attrs["type"] === "application/ld+json");
					const allParsedJsonLd = allJSONLDs.flatMap((jsonLd) => {
						try {
							return [JSON.parse(jsonLd.innerHTML)];
						}catch(e) {
							return [];
						}
					});
					const validate = ajv.compile(additionalValidator.filter);
					const matchedJsonLds = allParsedJsonLd.filter((jsonLd) => {
						return validate(jsonLd) === true;
					});
					return (await Promise.all([
						(async () => {
							const schema = additionalValidator.schema;
							if (schema !== undefined) {
								return (await Promise.all(matchedJsonLds.map(async (matchedJsonLd) => {
									const validate = ajv.compile(schema);
									const validationResult = await validate(matchedJsonLd);
									if (!validationResult) {
										return validate.errors!.map((obj) => ({
											type: "JSON_LD_DOES_NOT_MATCH_SCHEMA",
											filter: additionalValidator.filter,
											result: obj,
											schema,
											url,
										} as const));
									}else {
										return [];
									}
								}))).flat(1);
							}else {
								return [];
							}
						})(),
						(async () => {
							if (matchedJsonLds.length >= (additionalValidator.minOccurrence ?? 0) && matchedJsonLds.length <= (additionalValidator.maxOccurrence ?? Number.MAX_SAFE_INTEGER)) {
								return [];
							}else {
								return [{
									type: "JSON_LD_DOES_NOT_MATCH_OCCURRENCE_REQUIREMENT",
									filter: additionalValidator.filter,
									minOccurrence: additionalValidator.minOccurrence,
									maxOccurrence: additionalValidator.maxOccurrence,
									actualOccurrence: matchedJsonLds.length,
									url,
								}] as const;
							}
						})(),
					])).flat(1);
				}else {
					return [];
				}
			}))).flat(1);
		})(),
	])).flat(1);
	// TODO: validate rss item can have 1 link and 1 guid
	// TODO: if rss.item.guid isPermalink=true or missing then validate target URL
	// TODO: validate atom item can have 1 id
}

