import type {DeepReadonly} from "ts-essentials";
import type {FoundPageFetchResult, UrlRole, LinkLocation, Assertion, FileFetchResult, VnuReportedError, AdditionalValidator} from "./index.ts";
import {validateFile as validateFileOrig} from "./validate-file.ts";
import {getLinks as getLinksOrig} from "./get-links.ts";
import type { Pool } from "./worker-runner.ts";
import {implementWorker} from "with-worker-threads";
import {checkLink as checkLinkOrig} from "./check-link.ts";
import {debuglog} from "node:util";

const log = debuglog("website-validator:worker");

export const validateFile = async ({baseUrl, indexName, url, res, roles, linkedFiles, vnuResults, additionalValidators}: {baseUrl: string, indexName: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>, linkedFiles: {[url: string]: FileFetchResult}, vnuResults: VnuReportedError[], additionalValidators: DeepReadonly<AdditionalValidator["config"][]>}) => {
	const startTime = new Date().getTime();
	const r = await validateFileOrig(baseUrl, indexName, url, res, roles, linkedFiles, vnuResults, additionalValidators);
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
