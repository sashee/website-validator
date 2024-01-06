import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime";
import Rx from "rxjs";
import RxJsOperators from "rxjs/operators";
import postcss from "postcss";
import os from "node:os";
import { strict as assert } from "node:assert";

export const withTempDir = async <T> (fn: (dir: string) => T) => {
	const dir = await fs.mkdtemp(await fs.realpath(os.tmpdir()) + path.sep);
	try {
		return await fn(dir);
	}finally {
		fs.rm(dir, {recursive: true});
	}
};

export const getElementLocation = (element: Element) => {
	const getElementPath = (element: Element): Element[] => {
		if (element.parentElement === null) {
			return [element];
		}else {
			return [...getElementPath(element.parentElement), element];
		}
	}
	return `${getElementPath(element).map((e) => {
		if (e.parentElement === null) {
			return e.tagName.toLowerCase();
		}else {
			return `${e.tagName.toLowerCase()}:nth-of-type(${[...e.parentElement.children].filter((elem) => elem.tagName === e.tagName).indexOf(e) + 1})`;
		}
	}).join(" > ")} - ${element.outerHTML}`;
}

const handleRangeRequests = async (req: http.IncomingMessage, res: http.ServerResponse, contents: Buffer, statusCode: number, headers: {[name: string]: string | string[]}) => {
	Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
	res.setHeader("Accept-Ranges", "bytes");
	if (statusCode === 200 && req.headers.range) {
		const size = contents.length;
		const ranges = req.headers.range.replace(/^bytes=/, "").split(",").map((range) => range.trim().split("-")) as [string, string][];
		if (ranges.every(([s, e]) => s.match(/^\d*$/) && e.match(/^\d*$/) && (s !== "" || e !== ""))) {
			const rangeResponses = ranges.map(([startStr, endStr]) => {
				const start = startStr === "" ? size - Number(endStr) : Number(startStr);
				const end = endStr === "" ? size - 1 : Number(endStr);
				return {
					start,
					end,
					content: contents.subarray(start, end + 1),
					satisfiable: start < size && end < size,
				};
			});
			if (rangeResponses.some(({satisfiable}) => {!satisfiable})) {
				res.writeHead(416, {"Content-Range": `bytes */${size}`});
				res.end();
				return;
			}
			if (rangeResponses.length === 1) {
				const {start, end, content} = rangeResponses[0]!;
				res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
				res.setHeader("Content-Length", end - start + 1);
				res.writeHead(206);
				res.end(content);
				return;
			}else if (rangeResponses.length > 1) {
				// TODO: implement
				throw new Error("Multiple ranges not implemented");
			}
		}
	}
	// can not use range response, go back to normal response
	res.writeHead(statusCode);

	res.end(contents);
}

export const orderedMergeMap = <T, R> (mapper: (input: T) => Promise<R>, concurrency: number) => Rx.pipe(
	RxJsOperators.mergeMap(async (input: T, index) => [await mapper(input), index] as const, concurrency), 
	RxJsOperators.scan(({lastEmittedIndex, results}, [result, idx]) => {
		const emit = [...results, {result, index: idx}].map((result, _, list) => [
			result,
			[...Array(result.index - lastEmittedIndex - 1).keys()].map((i) => i + lastEmittedIndex + 1)
				.every((i) => list.find(({index}) => index === i) !== undefined)
		] as const);
		
		return {
			emitting: emit
				.filter(([_result, emit]) => emit)
				.map(([result]) => result)
				.sort((a, b) => a.index - b.index)
				.map(({result}) => result),
			lastEmittedIndex: Math.max(
				lastEmittedIndex,
				...emit.filter(([_result, emit]) => emit).map(([{index}]) => index)
			),
			results: emit
				.filter(([_result, emit]) => !emit)
				.map(([result]) => result),
		}; 
	}, {emitting: [] as R[], lastEmittedIndex: -1, results: [] as {result: R, index: number}[]}),
	RxJsOperators.mergeMap(({emitting}) => emitting)
);

export const extractAllUrlsFromCss = async (css: string) => {
	const result = [] as {url: string, parent: string | undefined, prop?: string, position: string}[];
	const plugin: postcss.PluginCreator<any> = () => {
		return {
			postcssPlugin: "test",
			Declaration: (decl: postcss.Declaration) => {
				// TODO: also extract the optional format()
				// see: https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/src
				const urlPattern = /url\((?<n>([^\)]|(?<=\\)\))*)\)/g;
				if (decl.value && decl.value.match(urlPattern)) {
					const urls = [...decl.value.match(urlPattern)!];
					urls.filter((url) => !url.startsWith("url(\"data:") && !url.startsWith("url(data:")).map((url) => {
						const getPath = (decl: postcss.Container["parent"]): string[] => {
							if (decl) {
								const asString = (decl: NonNullable<postcss.Container["parent"]>) => {
									if (decl.type === "atrule") {
										return "@" + (decl as postcss.AtRule).name;
									}else if (decl.type === "rule") {
										return (decl as postcss.Rule).selector;
									}else {
										return decl.type;
									}
								}
								return [...getPath(decl.parent), asString(decl)];
							}else {
								return [];
							}
						}
						const position = [...getPath(decl.parent), decl.prop].join(" / ");
						const parent = decl.parent === undefined ? undefined : (
							decl.parent.type === "atrule" ? "@" + (decl.parent as postcss.AtRule).name : (
								decl.parent.type === "rule" ? (decl.parent as postcss.Rule).selector : (
									undefined
								)
							)
						)
						const matchedUrl = url.match(/^url\("?(?<data>.*)"?\)$/);
						assert(matchedUrl, `could not parse css url: ${url} , decl.value: ${decl.value}`);
						result.push({url: matchedUrl.groups!["data"]!, parent, prop: decl.prop, position});
					});
				}
			}
		}
	};
	plugin.postcss = true;
	await postcss([plugin]).process(css, {from: undefined});
	return result;
}

export const startStaticFileServer = (directory: string, port: number, indexFileName: string) => {
	const app = http.createServer((request, response) => {
		request.addListener("end", async () => {
			const reqPath = request.url!.match("^[^?]*")![0];
			const url = reqPath.endsWith("/") ? reqPath + indexFileName : reqPath;
			const contentType = mime.getType(path.extname(url)) ?? "application/octet-stream";
			try {
				const contents = await fs.readFile(path.join(directory, url));
				await handleRangeRequests(request, response, contents, 200, {
					"Content-Type": contentType,
				});
			}catch(e: any) {
				if (e.code === "ENOENT") {
					response.writeHead(404);
					response.end();
				}else {
					throw e;
				}
			}
		}).resume();
	});
	return new Promise<typeof app>((res) => {
		app.listen(port, () => {
			res(app);
		});
	});
}

