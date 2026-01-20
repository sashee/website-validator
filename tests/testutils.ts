import {withTempDir} from "../src/utils.ts";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

export const setupTestFiles = (files: {filename: string, contents: string | Buffer}[]) => async <T> (fn: (dir: string) => T) => {
	return withTempDir(async (dir) => {
		await Promise.all(files.map(async ({filename, contents}) => {
			const name = path.join(dir, filename);

			await fs.mkdir(path.dirname(name), {recursive: true});
			await fs.writeFile(name, contents)
		}));
		return fn(dir);
	});
}

export const initFailIds = () => {
	const ids = [] as string[];
	return {
		nextFailId: () => {
			const nextId = crypto.randomUUID();
			ids.push(nextId);
			return nextId;
		},
		getFailIds: () => ids,
	}
};

export const baseHtmlContents = `
<!DOCTYPE html>
<html lang="en-us">
	<head>
		<title>title</title>
	</head>
	<body>
	</body>
</html>
`

export const baseIndexFile = {
	filename: "index.html",
	contents: baseHtmlContents,
};

