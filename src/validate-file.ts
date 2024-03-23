import {DeepReadonly} from "ts-essentials";
import {FoundPageFetchResult, UrlRole, ValidationResultType, getRedirect, isInternalLink, toCanonical} from "./index.js";
import {JSDOM} from "jsdom";
import {findAllTagsInHTML, getElementLocation, validateEpub, validatePdf, vnuValidate} from "./utils.js";
import fs from "node:fs/promises";
import robotsParser from "robots-parser";
import { getUrlsFromSitemap } from "./get-links.js";
import path from "node:path";
import xml2js from "xml2js";

export const validateFile = async (baseUrl: string, indexName: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>): Promise<ValidationResultType[]> => {
	const contentType = Object.entries(res.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
	const redirect = await getRedirect(res);
	const allRedirectErrors = await (async () => {
		if (redirect !== undefined && contentType === "text/html") {
				const allLinks = await findAllTagsInHTML("link", res.data);
				const allCanonicals = allLinks.filter((link) => link.attrs["rel"] === "canonical");
				if (allCanonicals.length > 0) {
					const canonicalHref = allCanonicals[0].attrs["href"] ? toCanonical(baseUrl, indexName)(allCanonicals[0].attrs["href"]) : "";
					if (canonicalHref !== redirect) {
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
			return [...htmlErrors, ...jsonLdErrors, ...canonicalLinkErrors];
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

