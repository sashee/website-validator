import {DeepReadonly} from "ts-essentials";
import {FileFetchResult, FoundPageFetchResult, UrlRole, ValidationResultType, getRedirect, isInternalLink, toCanonical} from "./index.js";
import {JSDOM} from "jsdom";
import {findAllTagsInHTML, getElementLocation, validateEpub, validatePdf, vnuValidate, getImageDimensions} from "./utils.js";
import fs from "node:fs/promises";
import robotsParser from "robots-parser";
import { getUrlsFromSitemap } from "./get-links.js";
import path from "node:path";
import xml2js from "xml2js";
import { strict as assert } from "node:assert";
import {parseSrcset} from "srcset";

export const validateFile = async (baseUrl: string, indexName: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>, linkedFiles: {[url: string]: FileFetchResult}): Promise<ValidationResultType[]> => {
	const contentType = Object.entries(res.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
	const redirect = await getRedirect(res);
	const allRedirectErrors = await (async () => {
		if (redirect !== undefined && contentType === "text/html") {
				const allLinks = await findAllTagsInHTML("link", res.data);
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
	})();
	const allDocumentErrors = await (async () => {
		if (contentType === "text/html") {
			const contents = await fs.readFile(res.data.path);
			const dom = new JSDOM(contents.toString("utf8"), {url: baseUrl});
			const htmlErrors = await (async () => {
				return (await vnuValidate(res.data, "html")).map((object) => {
					return {
						type: "VNU",
						object,
						location: {
							url,
						}
					} as const;
				});
			})();
			const canonicalLinkErrors = await (async () => {
				const allLinks = await findAllTagsInHTML("link", res.data);
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
			})();
			const jsonLdErrors = (() => {
				const allJSONLDs = [...dom.window.document.querySelectorAll("script[type='application/ld+json']")];
				return allJSONLDs.flatMap((jsonLd) => {
					try {
						JSON.parse(jsonLd.innerHTML);
						return [] as const;
					}catch {
						return [{type: "JSON_LD_UNPARSEABLE", location: {url, location: {outerHTML: jsonLd.outerHTML, selector: getElementLocation(jsonLd)}}}] as const;
					}
				});
			})();
			const imgErrors = await (async () => {
				const allImgs = await findAllTagsInHTML("img", res.data);
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
							return Math.abs(l[0].height - height * l[0].width / width) > 1
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
			})();
			return [...htmlErrors, ...jsonLdErrors, ...canonicalLinkErrors, ...imgErrors];
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
				return (await vnuValidate(res.data, "css")).map((object) => {
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
				return (await vnuValidate(res.data, "svg")).map((object) => {
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
	})();
	// TODO: validate rss item can have 1 link and 1 guid
	// TODO: if rss.item.guid isPermalink=true or missing then validate target URL
	// TODO: validate atom item can have 1 id
	return [...allRedirectErrors, ...allDocumentErrors];
}

