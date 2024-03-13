import {DeepReadonly} from "ts-essentials";
import {FoundPageFetchResult, UrlRole, ValidationResultType, isInternalLink} from "./index.js";
import {JSDOM} from "jsdom";
import {collectAllIdsFromPage, getElementLocation} from "./utils.js";
import fs from "node:fs/promises";
import robotsParser from "robots-parser";
import { getUrlsFromSitemap } from "./get-links.js";
import path from "node:path";

export const validateFile = async (baseUrl: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>): Promise<ValidationResultType[]> => {
	const contentType = res.headers.find(([name]) => name.toLowerCase() === "content-type")![1];
	const allDocumentErrors = await (async () => {
		if ((contentType === "text/html" || roles.some(({type}) => type === "document"))) {
			const contents = await fs.readFile(res.data.path);
			const dom = new JSDOM(contents.toString("utf8"), {url: baseUrl});
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
			const documentErrors = await (async () => {
				const allIds = await collectAllIdsFromPage(res.data);
				const duplicateIds = allIds.filter(({id}, _i, l) => {
					return l.filter((e) => e.id === id).length > 1;
				});
				const groups = duplicateIds.reduce((memo, elem) => {
					if (memo[elem.id]) {
						memo[elem.id].push(elem);
						return memo;
					}else {
						return {
							...memo,
							[elem.id]: [elem],
						};
					}
				}, {} as {[id: string]: typeof duplicateIds});
				return Object.entries(groups).flatMap(([id, elems]) => {
					return [{
						type: "MULTIPLE_IDS",
						location: {
							url,
							id,
							elements: elems.map(({outerHTML, selector}) => ({outerHTML, selector})),
						}
					}] as const;
				})
			})();
			return [...jsonLdErrors, ...documentErrors];
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
		}else {
			return [];
		}
	})();
	// TODO: validate rss item can have 1 link and 1 guid
	// TODO: if rss.item.guid isPermalink=true or missing then validate target URL
	// TODO: validate atom item can have 1 id
	return [...allDocumentErrors];
}

