import {DeepReadonly} from "ts-essentials";
import {FoundPageFetchResult, UrlRole, LinkLocation, Assertion} from "./index.js";
import {validateFile as validateFileOrig} from "./validate-file.js";
import {getLinks as getLinksOrig} from "./get-links.js";
import { Pool } from "./worker-runner.js";
import {implementWorker} from "with-worker-threads";

export const validateFile = async ({baseUrl, url, res, roles}: {baseUrl: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>}) => {
	const r = await validateFileOrig(baseUrl, url, res, roles);
	return r;
};

export const getLinks = async ({baseUrl, url, role, res}: {baseUrl: string, url: string, role: DeepReadonly<UrlRole>, res: FoundPageFetchResult}): Promise<DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]>> => {
	const r = await getLinksOrig(baseUrl, url, role, res);
	return r;
};

implementWorker<Pool>({
	validateFile: (...args) => validateFile(...args),
	getLinks: (...args) => getLinks(...args),
})
