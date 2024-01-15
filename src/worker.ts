import {DeepReadonly} from "ts-essentials";
import {FoundPageFetchResult, UrlRole, LinkLocation, Assertion} from "./index.js";
import {validateFile as validateFileOrig} from "./validate-file.js";
import {getLinks as getLinksOrig} from "./get-links.js";

export const validateFile = async ({baseUrl, url, res, roles}: {baseUrl: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>}) => {
	return validateFileOrig(baseUrl, url, res, roles);
};

export const getLinks = async ({baseUrl, url, role, res}: {baseUrl: string, url: string, role: DeepReadonly<UrlRole>, res: FoundPageFetchResult}): Promise<DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]>> => {
	return getLinksOrig(baseUrl, url, role, res);
};

