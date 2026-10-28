// SPDX-License-Identifier: GPL-3.0-or-later
// TinyMCE 7, bundled (GPL-2.0-or-later, licence key "gpl": no cloud, no API key). Loaded on demand
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
