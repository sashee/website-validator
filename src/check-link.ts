import { strict as assert } from "node:assert";
import {DeepReadonly} from "ts-essentials";
import { Assertion, LinkLocation, toCanonical, LinkErrorTypes, fetchFileGraph, FileFetchResult, isInternalLink, ValidationResultType, getRedirect, FoundPageFetchResult } from "./index.js";
import { getInterestingPageElements } from "./utils.js";

export const checkLink = (baseUrl: string, indexName: string) => async (link: {url: string, asserts: readonly Assertion[], location: LinkLocation}, target: DeepReadonly<FileFetchResult>): Promise<ValidationResultType[]> => {
	if (isInternalLink(baseUrl)(link.url)) {
		if (target.data === null) {
			return [{
				type: "TARGET_NOT_FOUND",
				location: {
					url: link.url,
					location: link.location,
				}
			}];
		}else {
			const contentType = Object.entries(target.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
			const redirectErrors = await(async () => {
				const redirect = await getRedirect(target as FoundPageFetchResult);
				if (link.location.type === "redirect" && redirect !== undefined) {
					return [{
						type: "REDIRECT_CHAIN",
						targetUrl: redirect,
						location: link,
					}] as const;
				}else {
					return [];
				}
			})();
			const targetErrors = await (async () => {
				if (contentType === "text/html") {
					const hash = new URL(link.url, baseUrl).hash;
					if (hash !== "") {
						// validate hash
						const allIdsOnPage = (await getInterestingPageElements(target.data!)).ids;
						if (!allIdsOnPage.map(({id}) => id).includes(hash.substring(1))) {
							return [{
								type: "HASH_TARGET_NOT_FOUND",
								location: {
									url: link.url,
									location: link.location,
								}
							}] as const;
						}else {
							return [];
						}
					}else {
						return [];
					}
				}else {
					if (new URL(link.url, baseUrl).hash !== "") {
						return [{
							type: "HASH_POINTS_TO_NON_DOCUMENT",
							location: {
								url: link.url,
								location: link.location,
							}
						}] as const;
					}else {
						return [];
					}
				}
			})();
			const assertErrors = link.asserts.flatMap((assert): ValidationResultType[] => {
				if (assert.type === "content-type") {
					const contentType = Object.entries(target.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
					if (!contentType || !assert.contentType.includes(contentType)) {
						return [{
							type: "CONTENT_TYPE_MISMATCH",
							expectedContentTypes: assert.contentType,
							actualContentType: contentType!,
							location: {
								url: link.url,
								location: link.location,
							}
						}] as const;
					}else {
						return [];
					}
				}else if (assert.type === "document") {
					const contentType = Object.entries(target.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
					if (contentType !== "text/html") {
						return [{
							type: "LINK_POINTS_TO_NON_DOCUMENT",
							location: {
								url: link.url,
								location: link.location,
							}
						}] as const;
					}else {
						return [];
					}
				}else {
					// TODO: check other asserts
					return [];
				}
			});
			return [...targetErrors, ...assertErrors, ...redirectErrors];
		}
	}else {
		return [];
	}
}

