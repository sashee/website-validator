import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import os from "node:os";
import { strict as assert } from "node:assert";
import {withFileCache} from "with-file-cache";
import crypto from  "node:crypto";
import {JSDOM} from "jsdom";
import { FoundPageFetchResult } from ".";

export const sha = (x: crypto.BinaryLike) => crypto.createHash("sha256").update(x).digest("hex");

export const addFileCache = withFileCache(
	{baseKey: async () => {
		const files = [
			"package-lock.json",
		];
		return (await Promise.all(files.map((file) => fs.readFile(file)))).map((contents) => sha(contents)).join(";");
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
			return `${e.tagName.toLowerCase()}:nth-of-type(${[...e.parentElement.children].filter((elem) => elem.tagName === e.tagName).indexOf(e) + 1})`;
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
						const matchedUrl = (() => {
							const res = url.match(/^url\((?<data>.*)\)$/);
							assert(res, `could not parse css url: ${url} , decl.value: ${decl.value}`);
							const resString = res!.groups!["data"]
							if (resString.startsWith("\"") && resString.endsWith("\"")) {
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

export const collectAllIdsFromPage = addFileCache(async (page: FoundPageFetchResult["data"]) => {
	const dom = new JSDOM(await fs.readFile(page.path, "utf8"));
	return [...dom.window.document.querySelectorAll("*[id]")].map((elem) => elem.id);
}, {calcCacheKey: (page) => ["collectAllIdsFromPage_1", page.path, page.mtime]});
