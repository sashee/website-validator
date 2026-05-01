import {JSDOM} from "jsdom";
import {parseSrcset} from "srcset";
import xml2js from "xml2js";
import type {Assertion, LinkLocation} from "./index.ts";

type FeedElement = {
	tagName: "a" | "img",
	attribute: "href" | "src" | "srcset",
	outerHTML: string,
};

type FeedUrlLocation = {
	type: "rssItemLink",
	feedUrl: string,
	channelIndex: number,
	itemIndex: number,
	linkIndex: number,
} | {
	type: "rssItemDescriptionHtml",
	feedUrl: string,
	channelIndex: number,
	itemIndex: number,
	element: FeedElement,
} | {
	type: "atomEntryLink",
	feedUrl: string,
	entryIndex: number,
	linkIndex: number,
} | {
	type: "atomEntryContentHtml",
	feedUrl: string,
	entryIndex: number,
	element: FeedElement,
};

export type FeedRelativeUrlError = {
	type: "FEED_RELATIVE_URL",
	url: string,
	location: FeedUrlLocation,
};

export type FeedUrl = {
	url: string,
	role: {type: "document"} | {type: "asset"},
	asserts: readonly Assertion[],
	location: LinkLocation,
	relativeLocation: FeedUrlLocation,
};

const firstText = (value: unknown): string[] => {
	if (typeof value === "string") {
		return [value];
	}else if (Array.isArray(value)) {
		return value.flatMap(firstText);
	}else if (typeof value === "object" && value !== null && "_" in value && typeof value._ === "string") {
		return [value._];
	}else {
		return [];
	}
};

const htmlUrls = (html: string) => {
	const dom = new JSDOM(`<body>${html}</body>`);
	const anchors = [...dom.window.document.querySelectorAll("a[href]")].map((element) => ({
		url: element.getAttribute("href")!,
		role: {type: "document"} as const,
		asserts: [] as const,
		element: {tagName: "a", attribute: "href", outerHTML: element.outerHTML} as const,
	}));
	const imgSrcs = [...dom.window.document.querySelectorAll("img[src]")].map((element) => ({
		url: element.getAttribute("src")!,
		role: {type: "asset"} as const,
		asserts: [{type: "image"}] as const,
		element: {tagName: "img", attribute: "src", outerHTML: element.outerHTML} as const,
	}));
	const imgSrcsets = [...dom.window.document.querySelectorAll("img[srcset]")].flatMap((element) => parseSrcset(element.getAttribute("srcset")!).map(({url}) => ({
		url,
		role: {type: "asset"} as const,
		asserts: [{type: "image"}] as const,
		element: {tagName: "img", attribute: "srcset", outerHTML: element.outerHTML} as const,
	})));
	return [...anchors, ...imgSrcs, ...imgSrcsets];
};

export const isAbsoluteFeedUrl = (url: string) => URL.canParse(url);

export const relativeFeedUrlErrors = (urls: readonly FeedUrl[]): FeedRelativeUrlError[] => urls.flatMap(({url, relativeLocation}) => {
	if (isAbsoluteFeedUrl(url)) {
		return [];
	}else {
		return [{type: "FEED_RELATIVE_URL", url, location: relativeLocation}];
	}
});

export const getRssUrls = async (contents: string, feedUrl: string): Promise<FeedUrl[]> => {
	const parsed = await xml2js.parseStringPromise(contents);
	const channels = (parsed.rss?.channel ?? []) as unknown[];
	return channels.flatMap((channel, channelIndex) => {
		const items = ((channel as {item?: unknown[]}).item ?? []);
		return items.flatMap((item, itemIndex) => {
			const links = firstText((item as {link?: unknown}).link).map((url, linkIndex): FeedUrl => ({
				url,
				role: {type: "document"},
				asserts: [{type: "permanent"}],
				location: {type: "rss", rssurl: feedUrl, channelIndex, linkIndex},
				relativeLocation: {type: "rssItemLink", feedUrl, channelIndex, itemIndex, linkIndex},
			}));
			const descriptions = firstText((item as {description?: unknown}).description).flatMap((description) => htmlUrls(description).map((htmlUrl): FeedUrl => ({
				url: htmlUrl.url,
				role: htmlUrl.role,
				asserts: htmlUrl.asserts,
				location: {type: "rssItemDescriptionHtml", feedUrl, channelIndex, itemIndex, element: htmlUrl.element},
				relativeLocation: {type: "rssItemDescriptionHtml", feedUrl, channelIndex, itemIndex, element: htmlUrl.element},
			})));
			return [...links, ...descriptions];
		});
	});
};

export const getAtomUrls = async (contents: string, feedUrl: string): Promise<FeedUrl[]> => {
	const parsed = await xml2js.parseStringPromise(contents);
	const entries = (parsed.feed?.entry ?? []) as unknown[];
	return entries.flatMap((entry, entryIndex) => {
		const links = (((entry as {link?: {$?: {href?: string}}[]}).link ?? []).flatMap((link, linkIndex): FeedUrl[] => {
			const url = link.$?.href;
			if (url === undefined) {
				return [];
			}else {
				return [{
					url,
					role: {type: "document"},
					asserts: [{type: "permanent"}],
					location: {type: "atom", atomurl: feedUrl, entryIndex, linkIndex},
					relativeLocation: {type: "atomEntryLink", feedUrl, entryIndex, linkIndex},
				}];
			}
		}));
		const contents = (((entry as {content?: ({_: string, $?: {type?: string}} | string)[]}).content ?? [])).flatMap((content) => {
			if (typeof content === "string") {
				return htmlUrls(content);
			}else if (content.$?.type === "html") {
				return htmlUrls(content._);
			}else {
				return [];
			}
		}).map((htmlUrl): FeedUrl => ({
			url: htmlUrl.url,
			role: htmlUrl.role,
			asserts: htmlUrl.asserts,
			location: {type: "atomEntryContentHtml", feedUrl, entryIndex, element: htmlUrl.element},
			relativeLocation: {type: "atomEntryContentHtml", feedUrl, entryIndex, element: htmlUrl.element},
		}));
		return [...links, ...contents];
	});
};
