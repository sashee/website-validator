import {it} from "node:test";
import path from "node:path";
import {validate} from "../index.js";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

it.skip("html error", async () => {
 try{
	 /*
	const res = await validate(path.join(__dirname, "static"), "https://example.com")([{url: "/", role: {type: "document"}}]);
	*/
	const res = await validate(path.join(__dirname, "..", "..", "..", "..", "awm", "blog", "_site"), "https://advancedweb.hu")([
		{url: "/", role: {type: "document"}},
		{url: "/robots.txt", role: {type: "robotstxt"}},
		{url: "/rss-sashee.xml", role: {type: "rss"}},
		{url: "/promos.json", role: {type: "json", extractConfigs: [{jmespath: "promos[*].url", asserts: [], role: {type: "document"}}, {jmespath: "promos[*].image", asserts: [{type: "image"}, {type: "permanent"}], role: {type: "asset"}}]}},
		{url: "/flashback.json", role: {type: "json", extractConfigs: [{jmespath: "[*].[image, \"small-image\"][]", asserts: [{type: "image"}, {type: "permanent"}], role: {type: "asset"}}, {jmespath: "[*].url", asserts: [{type: "permanent"}], role: {type: "document"}}]}},
	], {});
	console.log(JSON.stringify(res, undefined, 4));
 }catch(e) {
	 console.error(e);
	 throw e;
 }
});

