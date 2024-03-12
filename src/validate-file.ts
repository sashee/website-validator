import {DeepReadonly, DeepWritable} from "ts-essentials";
import {FoundPageFetchResult, UrlRole} from "./index.js";
import {JSDOM} from "jsdom";
import {getElementLocation} from "./utils.js";
import fs from "node:fs/promises";

export const validateFile = async (baseUrl: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>) => {
	const allDocumentErrors = await (async () => {
		if (roles.some(({type}) => type === "document") && res.data !== null) {
			const contents = await fs.readFile(res.data.path);
			const dom = new JSDOM(contents.toString("utf8"), {url: baseUrl});
			const allJSONLDs = [...dom.window.document.querySelectorAll("script[type='application/ld+json']")];
			return allJSONLDs.flatMap((jsonLd) => {
				try {
					JSON.parse(jsonLd.innerHTML);
					return [] as const;
				}catch {
					return [{type: "JSON_LD_UNPARSEABLE", location: {url, location: {outerHTML: jsonLd.outerHTML, selector: getElementLocation(jsonLd)}}}] as const;
				}
			});
		}else {
			return [];
		}
	})();
	// TODO: validate rss item can have 1 link and 1 guid
	// TODO: if rss.item.guid isPermalink=true or missing then validate target URL
	// TODO: validate atom item can have 1 id
	return [...allDocumentErrors];
}

