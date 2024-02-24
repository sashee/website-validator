import url from "url";
import path from "node:path";
import {withWorkerThreads} from "with-worker-threads";
import { getLinks, validateFile } from "./worker";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// TODO: remove when there are no more warnings
process.env["NODE_NO_WARNINGS"] = "1";

export type Pool = {
	validateFile: typeof validateFile,
	getLinks: typeof getLinks,
};

export const withPool = (concurrency?: number) => withWorkerThreads<Pool>({
	validateFile: (tasker) => (...args) => tasker(args),
	getLinks: (tasker) => (...args) => tasker(args),
})(path.resolve(__dirname, "worker.js"), {
		...(concurrency === undefined ? {} : {concurrency}),
});
