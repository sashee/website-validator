import {DeepReadonly} from "ts-essentials";
import {FoundPageFetchResult, UrlRole, LinkLocation, Assertion, FileFetchResult, VnuReportedError} from "./index.js";
import {validateFile as validateFileOrig} from "./validate-file.js";
import {getLinks as getLinksOrig} from "./get-links.js";
import { Pool } from "./worker-runner.js";
import {implementWorker} from "with-worker-threads";
import {checkLink as checkLinkOrig} from "./check-link.js";
import debug from "debug";

const log = debug("website-validator:worker");

export const validateFile = async ({baseUrl, indexName, url, res, roles, linkedFiles, vnuResults}: {baseUrl: string, indexName: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>, linkedFiles: {[url: string]: FileFetchResult}, vnuResults: VnuReportedError[]}) => {
	const startTime = new Date().getTime();
	const r = await validateFileOrig(baseUrl, indexName, url, res, roles, linkedFiles, vnuResults);
	log("validateFile called with %s, finished in %d", url, new Date().getTime() - startTime);
	return r;
};

export const getLinks = async ({url, role, res}: {url: string, role: DeepReadonly<UrlRole>, res: FoundPageFetchResult}): Promise<DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]>> => {
	const startTime = new Date().getTime();
	const r = await getLinksOrig(url, role, res);
	log("getLinks called with %s, finished in %d", url, new Date().getTime() - startTime);
	return r;
};

export const checkLink = async ({baseUrl, indexName, link, target}: {baseUrl: string, indexName: string, target: Parameters<ReturnType<typeof checkLinkOrig>>[1], link: Parameters<ReturnType<typeof checkLinkOrig>>[0]}) => {
	const startTime = new Date().getTime();
	const r = await checkLinkOrig(baseUrl, indexName)(link, target);
	log("checkLink called with %s, finished in %d", link.url, new Date().getTime() - startTime);
	return r;
};

implementWorker<Pool>({
	validateFile: (...args) => validateFile(...args),
	getLinks: (...args) => getLinks(...args),
	checkLink: (...args) => checkLink(...args),
})
