import {DeepReadonly} from "ts-essentials";
import {FoundPageFetchResult, UrlRole, LinkLocation, Assertion, log} from "./index.js";
import {validateFile as validateFileOrig} from "./validate-file.js";
import {getLinks as getLinksOrig} from "./get-links.js";
import { Pool } from "./worker-runner.js";
import {implementWorker} from "with-worker-threads";
import {checkLink as checkLinkOrig} from "./check-link.js";

export const validateFile = async ({baseUrl, url, res, roles}: {baseUrl: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>}) => {
	const r = await validateFileOrig(baseUrl, url, res, roles);
	return r;
};

export const getLinks = async ({baseUrl, url, role, res}: {baseUrl: string, url: string, role: DeepReadonly<UrlRole>, res: FoundPageFetchResult}): Promise<DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]>> => {
	const r = await getLinksOrig(baseUrl, url, role, res);
	return r;
};

export const checkLink = async ({baseUrl, indexName, link, target}: {baseUrl: string, indexName: string, target: Parameters<ReturnType<typeof checkLinkOrig>>[1], link: Parameters<ReturnType<typeof checkLinkOrig>>[0]}) => {
	const r = await checkLinkOrig(baseUrl, indexName)(link, target);
	log("checkLink called with %s, result: %s", JSON.stringify({baseUrl, indexName, link, target}, undefined, 4), JSON.stringify(r, undefined, 4));
	return r;
};

implementWorker<Pool>({
	validateFile: (...args) => validateFile(...args),
	getLinks: (...args) => getLinks(...args),
	checkLink: (...args) => checkLink(...args),
})
