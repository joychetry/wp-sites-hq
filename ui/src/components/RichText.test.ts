// SPDX-License-Identifier: GPL-3.0-or-later
// The editor's helpers: WordPress's autop, the safe preview of site HTML, and what Add media inserts.
import { autop, mediaHtml, safeHtml, WP_TOOLBAR } from "./RichText";
import type { Media } from "../api";

const SHOP: Media = { id: 9, title: "shop", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", mime: "image/jpeg", alt: "The shop", date: "", caption: "", description: "", file_name: "shop.jpg", author: "Joy", width: 0, height: 0, size: 0, thumb: "", usage: null };

const html = (f: DocumentFragment) => {
  const d = document.createElement("div");
  d.append(f);
  return d.innerHTML;
};

test("autop makes paragraphs and line breaks as WordPress does, and leaves block tags alone", () => {
  expect(autop("One\nline two\n\nThree")).toBe("<p>One<br>\nline two</p>\n<p>Three</p>");
  expect(autop("Intro\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\nAfter")).toBe("<p>Intro</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<p>After</p>");
  expect(autop("<p>Kept</p>")).toBe("<p>Kept</p>");
  expect(autop("Before<!--more-->\n\nAfter")).toBe("<p>Before<!--more--></p>\n<p>After</p>");
  expect(autop("  \r\n ")).toBe("");
});

test("site HTML shown before the editor starts keeps inline tags only, and links without an address", () => {
  // A live link there would take the app window to the site's address on the click that starts the editor.
  expect(html(safeHtml('<b>Bold</b> <a href="https://x.test" onclick="evil()">link</a> <a href="/x">here</a>'))).toBe("<b>Bold</b> <a>link</a> <a>here</a>");
  expect(html(safeHtml('<img src=x onerror="evil()"><script>evil()</script><a href="javascript:evil()">x</a>'))).toBe("evil()<a>x</a>");
  expect(html(safeHtml("<div><em>in</em> a div</div>"))).toBe("<em>in</em> a div");
});

test("Add media inserts an image with its id class, or a link for other files", () => {
  expect(mediaHtml({ ...SHOP, width: 640, height: 480, alt: 'The "shop"' })).toBe('<img class="alignnone size-full wp-image-9" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="The &quot;shop&quot;" width="640" height="480" />');
  expect(mediaHtml({ ...SHOP, mime: "application/pdf", url: "https://x.test/a.pdf", title: "Menu <PDF>" })).toBe('<a href="https://x.test/a.pdf">Menu &lt;PDF></a>');
});

test("the toolbar is WordPress's two rows, with the Read more tag", () => {
  expect(WP_TOOLBAR.split(" | ")).toHaveLength(2);
  for (const b of ["bold", "italic", "bullist", "numlist", "blockquote", "link", "wpmore", "strikethrough", "hr", "forecolor", "pastetext", "removeformat", "charmap", "outdent", "indent", "undo", "redo"]) expect(WP_TOOLBAR.split(/\s+/)).toContain(b);
});
