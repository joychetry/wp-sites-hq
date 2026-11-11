// SPDX-License-Identifier: GPL-3.0-or-later
// TinyMCE 8, bundled (GPL-2.0-or-later, licence key "gpl": no cloud, no API key). Loaded on demand
// by RichText, so the rest of the app doesn't carry it. The media plugin is never loaded
// (GHSA-mf2p-h6hf-fcwm is in that plugin, and Add media inserts plain <img> through our picker).
import tinymce from "tinymce/tinymce";
import "tinymce/models/dom";
import "tinymce/themes/silver";
import "tinymce/icons/default";
import "tinymce/plugins/lists";
import "tinymce/plugins/link";
import "tinymce/plugins/charmap";
import "tinymce/skins/ui/oxide/skin.min.css";
import "tinymce/skins/ui/oxide/content.inline.min.css";

export default tinymce;

// TinyMCE's own English, in the app's words: sentence case, no slashes or three dots.
tinymce.addI18n("en", {
  "Insert/edit link": "Add a link",
  "Insert/Edit Link": "Add a link",
  "Text to display": "Link text",
  "Open link in...": "Open in",
});
