import {DeepReadonly} from "ts-essentials";
import {FoundPageFetchResult, UrlRole, LinkLocation, Assertion, FileFetchResult} from "./index.js";
import {validateFile as validateFileOrig} from "./validate-file.js";
import {getLinks as getLinksOrig} from "./get-links.js";
import { Pool } from "./worker-runner.js";
import {implementWorker} from "with-worker-threads";
import {checkLink as checkLinkOrig} from "./check-link.js";
import debug from "debug";

const log = debug("website-validator:worker");

export const validateFile = async ({baseUrl, indexName, url, res, roles, linkedFiles}: {baseUrl: string, indexName: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>, linkedFiles: {[url: string]: FileFetchResult}}) => {
	const r = await validateFileOrig(baseUrl, indexName, url, res, roles, linkedFiles);
	log("validateFile called with %s, result: %s", JSON.stringify({baseUrl, indexName, url, res, roles}, undefined, 4), JSON.stringify(r, undefined, 4));
	return r;
};

export const getLinks = async ({baseUrl, url, role, res}: {baseUrl: string, url: string, role: DeepReadonly<UrlRole>, res: FoundPageFetchResult}): Promise<DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]>> => {
	const r = await getLinksOrig(baseUrl, url, role, res);
	log("getLinks called with %s, result: %s", JSON.stringify({baseUrl, url, role, res}, undefined, 4), JSON.stringify(r, undefined, 4));
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
