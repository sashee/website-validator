import Piscina from "piscina";
import url from "url";
import path from "node:path";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
//
// TODO: remove when there are no more warnings
process.env["NODE_NO_WARNINGS"] = "1";

export const pool = new Piscina({
  filename: path.resolve(__dirname, "worker.js"),
	...process.env["MAX_THREADS"] ? {maxThreads: Number(process.env["MAX_THREADS"])} : {},
});
