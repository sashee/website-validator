import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import os from "node:os";
import { strict as assert } from "node:assert";
import {withFileCache} from "with-file-cache";
import crypto from  "node:crypto";
import {JSDOM} from "jsdom";
import { EpubcheckError, FoundPageFetchResult, VnuReportedError, VnuResult } from "./index.js";
import {execFile} from "node:child_process";
import util from "node:util";
import vnu from "vnu-jar";
import * as epubcheck from "epubcheck-static";
import sharp from "sharp";
import {DeepReadonly} from "ts-essentials";
import {getDocument, VerbosityLevel} from "pdfjs-dist/legacy/build/pdf.mjs";
import deps from "./deps.json" with {type: "json"};

assert(deps.java);

export const sha = (x: crypto.BinaryLike) => crypto.createHash("sha256").update(x).digest("hex");

export const addFileCache = withFileCache(
	{baseKey: async () => {
		return (await Promise.all([
			(async () => {
				const files = [
					"package-lock.json",
				];
				return (await Promise.all(files.map((file) => fs.readFile(file).then((contents) => sha(contents))))).join(";");
			})(),
		])).reduce((memo, val) => sha(memo + ";" + val), "");
	}},
);

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
			function getElIndex(el: Element | null) {
				let i = 0;
				for (i = 0; el = el!.previousElementSibling; i++);
				return i;
			}
			return `${e.tagName.toLowerCase()}:nth-child(${getElIndex(e) + 1})`;
		}
	}).join(" > ")} - ${element.outerHTML}`;
}

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
					urls.filter((url) => !url.startsWith("url(\"data:") && !url.startsWith("url(data:") && !url.startsWith("url('data:")).map((url) => {
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
						const matchedUrl = (() => {
							const res = url.match(/^url\((?<data>.*)\)$/);
							assert(res, `could not parse css url: ${url} , decl.value: ${decl.value}`);
							const resString = res!.groups!["data"]
							if ((resString.startsWith("\"") && resString.endsWith("\"")) || (resString.startsWith("'") && resString.endsWith("'"))) {
								if (resString.length === 1) {
									throw new Error("Whops");
								}
								return resString.substring(1, resString.length - 1);
							}else {
								return resString;
							}
						})();
						result.push({url: matchedUrl, parent, prop: decl.prop, position});
					});
				}
			}
		}
	};
	plugin.postcss = true;
	await postcss([plugin]).process(css, {from: undefined});
	return result;
}

export const getInterestingPageElements = addFileCache(async (page: FoundPageFetchResult["data"]) => {
	const dom = new JSDOM(await fs.readFile(page.path, "utf8"));
	const ids = [...dom.window.document.querySelectorAll("*[id]")].map((elem) => ({
		outerHTML: elem.outerHTML,
		id: elem.id,
		selector: getElementLocation(elem),
	}));
	const elementsWithTageName = (tagName: string) => {
		return [...dom.window.document.querySelectorAll(tagName)]
		.map((tag) => ({
			attrs: Object.fromEntries(tag.getAttributeNames().map((name) => [name, tag.getAttribute(name)! as string | undefined])),
			outerHTML: tag.outerHTML,
			selector: getElementLocation(tag),
			innerHTML: tag.innerHTML,
		}));
	}
	return {
		ids,
		tagCollections: {
			img: elementsWithTageName("img"),
			link: elementsWithTageName("link"),
			meta: elementsWithTageName("meta"),
			script: elementsWithTageName("script"),
			video: elementsWithTageName("video"),
			a: elementsWithTageName("a"),
		}
	}
}, {calcCacheKey: (page) => ["getInterestingPageElements_2", page.path, page.mtime]});

export const vnuValidates = async (files: DeepReadonly<Array<{data: FoundPageFetchResult["data"], type: "html" | "css" | "svg"}>>) => {
	const byType = files.reduce((memo, file) => {
		if (memo[file.type]) {
			memo[file.type].push(file.data);
			return memo;
		}else {
			memo[file.type] = [file.data];
			return memo;
		}
	}, {} as {[type: string]: Array<(typeof files)[number]["data"]>});

	return (await Promise.all(Object.entries(byType).map(async ([type, datas]) => {
		// TODO: streaming result
		const {stdout} = await util.promisify(execFile)(`${deps.java}/bin/java`, ["-jar", vnu, `--${type}`, "--exit-zero-always", "--stdout", "--format", "json", ...datas.map(({path}) => path)], {maxBuffer: 100*1024*1024});
		const out = JSON.parse(stdout) as VnuResult;
		if (out.messages.some(({type}) => type === "non-document-error")) {
			throw new Error(JSON.stringify(out.messages, undefined, 4));
		}
		return out.messages as (VnuReportedError & {url: string})[];
	}))).flat(1) .reduce((memo, message) => {
		assert(message.url.startsWith("file:"));
		const absolutePath = message.url.substring("file:".length);
		if (memo[absolutePath]) {
			memo[absolutePath].push(message);
			return memo;
		}else {
			throw new Error("Result path is not in files path");
		}
	}, Object.fromEntries(files.map(({data}) => [data.path, []])) as {[url: string]: VnuReportedError[]});
};

export const validateEpub = addFileCache(async (data: FoundPageFetchResult["data"]) => {
	return withTempDir(async (dir) => {
		const outPath = path.join(dir, "out");
		try {
			await util.promisify(execFile)(`${deps.java}/bin/java`, ["-jar", epubcheck.path, "--json", outPath, data.path]);
			// move to catch with a dummy error
			// so the read is not duplicated
			throw new Error("move to catch");
		}catch(e) {
			// epubcheck will exit with 1 if it found errors
			// so try to read and parse the output
			// and only throw an error if that fails
			try {
				const result = await fs.readFile(outPath, "utf8");
				return JSON.parse(result).messages as EpubcheckError[];
			}catch(e) {
				console.error(e);
				throw e;
			}
		}
	});
}, {calcCacheKey: (data) => ["epubcheck_validate_1", data.path, data.mtime]});

export const validatePdf = addFileCache(async (data: FoundPageFetchResult["data"]) => {
	const pdf = await fs.readFile(data.path);
	try {
		const document = await getDocument({data: new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength), stopAtErrors: true, verbosity: VerbosityLevel.ERRORS}).promise;
		const page = await document.getPage(1);
		await page.getTextContent();
	}catch(e: any) {
		return [e.message];
	}
	return [];
}, {calcCacheKey: (data) => ["validatepdf_1", data.path, data.mtime]});

export const getImageDimensions = addFileCache(async (data: FoundPageFetchResult["data"]) => {
	const metadata = await sharp(await fs.readFile(data.path)).metadata();
	return {
		width: metadata.width,
		height: metadata.height,
	};
}, {calcCacheKey: (data) => ["getImageDimensions_1", data.path, data.mtime]});
