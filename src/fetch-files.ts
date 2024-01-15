import Rx from "rxjs";
import RxJsOperators from "rxjs/operators";
import {UrlRole, toCanonical, FoundPageFetchResult, isInternalLink, FileFetchResult} from "./index.js";
import {deepEqual} from "fast-equals";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import {DeepReadonly} from "ts-essentials";
import {pool} from "./worker-runner.js";
import {getLinks} from "./worker.js";

export const recursiveFetchFiles = (fetchFile: (url: string) => Promise<DeepReadonly<FileFetchResult>>, baseUrl: string, indexName: string) => async (startUrls: DeepReadonly<{url: string, role: UrlRole}[]>) => {
	if (startUrls.length === 0) {
		return [];
	}
	const urlSubject = new Rx.Subject<DeepReadonly<{url: string, role: UrlRole}>>();
	const uniqueUrls = urlSubject.pipe(
		RxJsOperators.scan(({cache}, {url, role}) => {
			if (cache.find((cacheElement) => url === cacheElement.url && deepEqual(role, cacheElement.role))) {
				return {cache, emit: []} as const;
			}else {
				return {cache: [...cache, {url, role}], emit: [{url, role}]} as const;
			}
		}, {cache: [] as DeepReadonly<{url: string, role: UrlRole}[]>, emit: [] as DeepReadonly<{url: string, role: UrlRole}[]>}),
		RxJsOperators.filter(({emit}) => emit.length > 0),
		RxJsOperators.mergeMap(({emit}) => emit),
		RxJsOperators.share(),
	);
	const results = uniqueUrls.pipe(
		RxJsOperators.mergeMap(async ({url, role}) => {
			const res = await fetchFile(url);

			return {
				url,
				role,
				res,
			};
		}, 10),
		RxJsOperators.mergeMap(async ({url, role, res}) => {
			if (res.data !== null) {
				const links = await (pool.run({baseUrl: toCanonical(baseUrl, indexName)(url), url, role, res: res as FoundPageFetchResult}, {name: getLinks.name}) as ReturnType<typeof getLinks>);
				const discoveredUrls = links.map((link) => ({url: toCanonical(url, indexName)(link.url), role: link.role}));
				discoveredUrls.filter(({url}) => isInternalLink(baseUrl)(url)).forEach(({url, role}) => urlSubject.next({url, role}));
				return {url, role, res: res as FoundPageFetchResult, links};
			}else {
				return {url, role, res, links: null};
			}
		}),
		RxJsOperators.share(),
	);
	uniqueUrls.pipe(
		RxJsOperators.scan((num) => num + 1, 0),
		RxJsOperators.combineLatestWith(
			results.pipe(
				RxJsOperators.scan((num) => num + 1, 0),
			),
		),
		//RxJsOperators.tap(([started, finished]) => console.log(`${finished} / ${started}`)),
		RxJsOperators.filter(([startedNum, finishedNum]) => startedNum === finishedNum),
	).subscribe(() => urlSubject.complete());
	startUrls.forEach(({url, role}) => urlSubject.next({url: toCanonical(baseUrl, indexName)(url), role}));
	return await Rx.lastValueFrom(results.pipe(RxJsOperators.toArray()));
}

