import {DeepReadonly, DeepWritable} from "ts-essentials";
import {FoundPageFetchResult, UrlRole} from "./index.js";
import {JSDOM} from "jsdom";
import {getElementLocation} from "./utils.js";
import fs from "node:fs/promises";

export const validateFile = async (baseUrl: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>) => {
	const allDocumentErrors = await (async () => {
		if (roles.some(({type}) => type === "document") && res.data !== null) {
			const contents = await fs.readFile(res.data);
			const dom = new JSDOM(contents.toString("utf8"), {url: baseUrl});
			const allJSONLDs = [...dom.window.document.querySelectorAll("script[type='application/ld+json']")];
			return allJSONLDs.flatMap((jsonLd) => {
				try {
					JSON.parse(jsonLd.innerHTML);
					return [];
				}catch {
					return [{type: "JSON_LD_UNPARSEABLE", location: {url, location: {type: "html", element: {outerHTML: jsonLd.outerHTML, selector: getElementLocation(jsonLd)}}}}];
				}
			});
		}else {
			return [];
		}
	})();
	return [...allDocumentErrors];
}

