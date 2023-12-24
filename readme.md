validators:

* .html
  * valid html
  * inline style => warning (potential CSP error)
  * style tag => warning (potential CSP error)
  * script tag with inline content => warning (potential CSP error)
    * link: https://portswigger.net/research/blind-css-exfiltration
  * ids unique on the page
  * link => target page exists (and is html) + fragment points to a valid place + fragment inside same page works
    * (live url only) if content type is defined for the link => validate that response has that content type
  * canonical url => canonical does not point to a redirect + target page has: no canonical or canonical === itself
    * at most 1 canonical url per page
  * external script/style: check if integrity present (otherwise the 3rd party can manipulate)
  * json/ld script tags
    * valid json format
    * structure matches
  * extract
    * styles
    * javascripts
    * images (src + srcset) + picture
    * videos (source, poster)
    * og image (+video) tags (+twitter, fb)
    * canonical url
    * rss/atom feed links
    * favicons (link[rel=icon])
* .js
  * (live url only) validate response content type
  * valid js file
* .css
  * (live url only) validate response content type
  * valid css file
  * extract
    * url(...)
* .xml
  * (live url only) validate response content type
  * valid xml
* .json
  * (live url only) validate response content type
  * valid json
  * if a string is a URL then validate that too: internal + exists
* .jpg, .jpeg
  * (live url only) validate response content type
  * valid jpeg
* .png
  * (live url only) validate response content type
  * valid png
* .svg
  * (live url only) validate response content type
  * valid xml
  * valid svg
  * extract: links
* .epub
  * (live url only) validate response content type
  * epub validator
* .pdf
  * (live url only) validate response content type
  * valid pdf
  * extract: links
* .zip
  * (live url only) validate response content type
  * valid zip
* robots.txt
  * (live url only) validate response content type
  * validate structure
  * gptbot disallow missing => warning
  * read sitemap(s) link
    * validate that sitemap is internal
  * host present => check if that's the same as in the argument
* sitemap
  * check all links are internal
  * text => all pages accessible
  * xml => check structure + lastmod + all pages accessible
* rss.xml (link[type=application/rss+xml] exists from an html)
  * (live url only) validate response content type
  * validate rss structure
  * validate timestamp formats
  * validate links point to internal, valid pages
* atom.xml (link[type=application/atom+xml])
  * (live url only) validate response content type
  * validate atom structure
  * validate timestamp formats
  * validate links point to internal, valid pages

extra:

* follow redirects: meta[http-equiv=refresh] + status codes (if site)
* validate: redirect chain: redirect's target is not a redirect

live url only:

* (if https) check tls certificate validity
* (if https) check if certificate is trusted from root
* ipv6 accessible

arguments:

* domain
* (optional) sitemap(s): url or contents
  * will be checked
* directory or live URL
* (live url only) max depth

results:

* errors
* (live url only) all files + response content types
* (configurable) screenshots for pages
* (configurable) lighthouse reports for pages
* link structure: what links to what
* rss stream(s)
* atom stream(s)
* sitemap(s) link

compare reports:

* any new errors
* new links in the sitemap(s)
* broken backlinks (+og:images + og:videos + inside json files)
* new rss item
* new atom item
