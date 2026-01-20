import url from "node:url";
import path from "node:path";
import {withWorkerThreads} from "with-worker-threads";
import { getLinks, validateFile, checkLink } from "./worker.ts";

const workerRunnerPath = url.fileURLToPath(import.meta.url);
const workerPath = path.join(path.dirname(workerRunnerPath), `worker${path.extname(workerRunnerPath)}`);

export type Pool = {
	validateFile: typeof validateFile,
	getLinks: typeof getLinks,
	checkLink: typeof checkLink,
};

export const withPool = (concurrency?: number) => withWorkerThreads<Pool>({
	validateFile: (tasker) => (...args) => tasker(args),
	getLinks: (tasker) => (...args) => tasker(args),
	checkLink: (tasker) => (...args) => tasker(args),
})(workerPath, {
		...(concurrency === undefined ? {} : {concurrency}),
});
