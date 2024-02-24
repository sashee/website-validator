import {DeepReadonly} from "ts-essentials";
import {FoundPageFetchResult, UrlRole, LinkLocation, Assertion} from "./index.js";
import {validateFile as validateFileOrig} from "./validate-file.js";
import {getLinks as getLinksOrig} from "./get-links.js";
import {isMainThread, parentPort} from "node:worker_threads";
import { Pool } from "./worker-runner.js";

export const validateFile = async ({baseUrl, url, res, roles}: {baseUrl: string, url: string, res: FoundPageFetchResult, roles: DeepReadonly<UrlRole[]>}) => {
	const r = await validateFileOrig(baseUrl, url, res, roles);
	return r;
};

export const getLinks = async ({baseUrl, url, role, res}: {baseUrl: string, url: string, role: DeepReadonly<UrlRole>, res: FoundPageFetchResult}): Promise<DeepReadonly<{url: string, role: UrlRole, asserts: readonly Assertion[], location: LinkLocation}[]>> => {
	const r = await getLinksOrig(baseUrl, url, role, res);
	return r;
};

if (!isMainThread) {
	parentPort!.on("message", async <T extends keyof Pool> ({close, operation, args, port}: {close: true, operation: undefined, args: undefined, port: undefined} | {close: undefined, operation: T, args: Parameters<Pool[T]>, port: MessagePort}) => {
		try {
			if (close) {
				parentPort!.close();
			}else {
				switch(operation) {
					case "validateFile": {
						const res = await validateFile(...args as Parameters<Pool["validateFile"]>);
						port.postMessage({result: res}, []);
						break;
					}
					case "getLinks": {
						const res = await getLinks(...args as Parameters<Pool["getLinks"]>);
						port.postMessage({result: res});
						break;
					}
					default:
						throw new Error("Unknown operation: " + operation)
				}
			}
		}catch(e) {
			console.error(e);
			port?.postMessage({error: e});
		}
	});
}
