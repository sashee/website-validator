import url from "url";
import path from "node:path";
import {withWorkerThreads} from "with-worker-threads";
import { getLinks, validateFile, checkLink } from "./worker.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export type Pool = {
	validateFile: typeof validateFile,
	getLinks: typeof getLinks,
	checkLink: typeof checkLink,
};

export const withPool = (concurrency?: number) => withWorkerThreads<Pool>({
	validateFile: (tasker) => (...args) => tasker(args),
	getLinks: (tasker) => (...args) => tasker(args),
	checkLink: (tasker) => (...args) => tasker(args),
})(path.resolve(__dirname, "worker.js"), {
		...(concurrency === undefined ? {} : {concurrency}),
});
