// SPDX-License-Identifier: GPL-3.0-or-later
// An ACF group with one field of every type, as get-acf-fields gives it (from mc-a and monks-central-test).
export const ACF_FIELDS = [
 {
  "key": "field_monks_test_fields_text",
  "name": "monks_test_fields_text",
  "label": "Text",
  "type": "text",
  "instructions": "A short line shown under the title.",
  "required": true,
  "editable": true,
  "settings": {
   "default_value": "",
   "maxlength": "",
   "placeholder": "",
   "prepend": "",
   "append": ""
  },
  "value": "Hello from WP Sites HQ"
 },
 {
  "key": "field_monks_test_fields_textarea",
  "name": "monks_test_fields_textarea",
  "label": "Textarea",
  "type": "textarea",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "default_value": "",
   "maxlength": "",
   "placeholder": "",
   "rows": ""
  },
  "value": "Edited live from WP Sites HQ"
 },
 {
  "key": "field_monks_test_fields_number",
  "name": "monks_test_fields_number",
  "label": "Number",
  "type": "number",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "min": 1,
   "max": 10,
   "default_value": "",
   "step": "",
   "placeholder": "",
   "prepend": "",
   "append": ""
  },
  "value": "7"
 },
 {
  "key": "field_monks_test_fields_range",
  "name": "monks_test_fields_range",
  "label": "Range",
  "type": "range",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "min": 0,
   "max": 100,
   "default_value": "",
   "step": "",
   "prepend": "",
   "append": ""
  },
  "value": "40"
 },
 {
  "key": "field_monks_test_fields_email",
  "name": "monks_test_fields_email",
  "label": "Email",
  "type": "email",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "default_value": "",
   "placeholder": "",
   "prepend": "",
   "append": ""
  },
  "value": "test@example.com"
 },
 {
  "key": "field_monks_test_fields_url",
  "name": "monks_test_fields_url",
  "label": "Url",
  "type": "url",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "default_value": "",
   "placeholder": ""
  },
  "value": "https://example.com/"
 },
 {
  "key": "field_monks_test_fields_password",
  "name": "monks_test_fields_password",
  "label": "Password",
  "type": "password",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "placeholder": "",
   "prepend": "",
   "append": ""
  },
  "value": "not-a-real-secret"
 },
 {
  "key": "field_monks_test_fields_select",
  "name": "monks_test_fields_select",
  "label": "Select",
  "type": "select",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "choices": {
    "red": "Red",
    "green": "Green",
    "blue": "Blue"
   },
   "multiple": 0,
   "allow_null": 0,
   "default_value": false,
   "ui": 0,
   "placeholder": ""
  },
  "value": "blue"
 },
 {
  "key": "field_monks_test_fields_checkbox",
  "name": "monks_test_fields_checkbox",
  "label": "Checkbox",
  "type": "checkbox",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "choices": {
    "a": "A",
    "b": "B",
    "c": "C"
   },
   "layout": "vertical",
   "default_value": []
  },
  "value": [
   "a",
   "c"
  ]
 },
 {
  "key": "field_monks_test_fields_radio",
  "name": "monks_test_fields_radio",
  "label": "Radio",
  "type": "radio",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "choices": {
    "s": "Small",
    "m": "Medium",
    "l": "Large"
   },
   "layout": "vertical",
   "default_value": "",
   "allow_null": 0
  },
  "value": "m"
 },
 {
  "key": "field_monks_test_fields_button_group",
  "name": "monks_test_fields_button_group",
  "label": "Button group",
  "type": "button_group",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "choices": {
    "left": "Left",
    "center": "Center",
    "right": "Right"
   },
   "default_value": "",
   "allow_null": 0,
   "layout": "horizontal"
  },
  "value": "center"
 },
 {
  "key": "field_monks_test_fields_true_false",
  "name": "monks_test_fields_true_false",
  "label": "True false",
  "type": "true_false",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "ui": 1,
   "default_value": 0,
   "ui_on_text": "",
   "ui_off_text": ""
  },
  "value": "1"
 },
 {
  "key": "field_monks_test_fields_wysiwyg",
  "name": "monks_test_fields_wysiwyg",
  "label": "Wysiwyg",
  "type": "wysiwyg",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "toolbar": "full",
   "media_upload": 1,
   "default_value": ""
  },
  "value": "<p>Some <strong>rich</strong> text.</p>"
 },
 {
  "key": "field_monks_test_fields_image",
  "name": "monks_test_fields_image",
  "label": "Image",
  "type": "image",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "mime_types": ""
  },
  "value": "31"
 },
 {
  "key": "field_monks_test_fields_file",
  "name": "monks_test_fields_file",
  "label": "File",
  "type": "file",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "mime_types": ""
  },
  "value": "31"
 },
 {
  "key": "field_monks_test_fields_date_picker",
  "name": "monks_test_fields_date_picker",
  "label": "Date picker",
  "type": "date_picker",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "display_format": "d/m/Y"
  },
  "value": "20261028"
 },
 {
  "key": "field_monks_test_fields_date_time_picker",
  "name": "monks_test_fields_date_time_picker",
  "label": "Date time picker",
  "type": "date_time_picker",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "display_format": "d/m/Y g:i a"
  },
  "value": "2026-10-28 18:43:18"
 },
 {
  "key": "field_monks_test_fields_time_picker",
  "name": "monks_test_fields_time_picker",
  "label": "Time picker",
  "type": "time_picker",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "display_format": "g:i a"
  },
  "value": "09:30:00"
 },
 {
  "key": "field_monks_test_fields_color_picker",
  "name": "monks_test_fields_color_picker",
  "label": "Color picker",
  "type": "color_picker",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "default_value": ""
  },
  "value": "#7a5af8"
 },
 {
  "key": "field_monks_test_fields_link",
  "name": "monks_test_fields_link",
  "label": "Link",
  "type": "link",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {},
  "value": {
   "title": "Example",
   "url": "https://example.com/",
   "target": "_blank"
  }
 },
 {
  "key": "field_monks_test_fields_post_object",
  "name": "monks_test_fields_post_object",
  "label": "Post object",
  "type": "post_object",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "post_type": [
    "post"
   ],
   "taxonomy": [],
   "allow_null": 0,
   "multiple": 0,
   "ui": 1
  },
  "value": "21"
 },
 {
  "key": "field_monks_test_fields_page_link",
  "name": "monks_test_fields_page_link",
  "label": "Page link",
  "type": "page_link",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "post_type": [
    "page"
   ],
   "taxonomy": [],
   "allow_null": 0,
   "multiple": 0
  },
  "value": "11"
 },
 {
  "key": "field_monks_test_fields_relationship",
  "name": "monks_test_fields_relationship",
  "label": "Relationship",
  "type": "relationship",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "post_type": [
    "post"
   ],
   "taxonomy": [],
   "min": 0,
   "max": 0
  },
  "value": [
   "21"
  ]
 },
 {
  "key": "field_monks_test_fields_taxonomy",
  "name": "monks_test_fields_taxonomy",
  "label": "Taxonomy",
  "type": "taxonomy",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "taxonomy": "category",
   "field_type": "checkbox",
   "multiple": 0,
   "allow_null": 0
  },
  "value": [
   1
  ]
 },
 {
  "key": "field_monks_test_fields_user",
  "name": "monks_test_fields_user",
  "label": "User",
  "type": "user",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "role": "",
   "multiple": 0,
   "allow_null": 0
  },
  "value": "1"
 },
 {
  "key": "field_monks_test_fields_group",
  "name": "monks_test_fields_group",
  "label": "Group",
  "type": "group",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "layout": "block"
  },
  "value": {
   "field_monks_test_fields_group_line": "Edited inside the group",
   "field_monks_test_fields_group_count": "4"
  },
  "sub_fields": [
   {
    "key": "field_monks_test_fields_group_line",
    "name": "line",
    "label": "Line",
    "type": "text",
    "instructions": "",
    "required": false,
    "editable": true,
    "settings": {
     "default_value": "",
     "maxlength": "",
     "placeholder": "",
     "prepend": "",
     "append": ""
    }
   },
   {
    "key": "field_monks_test_fields_group_count",
    "name": "count",
    "label": "Count",
    "type": "number",
    "instructions": "",
    "required": false,
    "editable": true,
    "settings": {
     "max": 5,
     "default_value": "",
     "min": "",
     "step": "",
     "placeholder": "",
     "prepend": "",
     "append": ""
    }
   }
  ]
 },
 {
  "key": "field_monks_test_fields_repeater",
  "name": "monks_test_fields_repeater",
  "label": "Repeater",
  "type": "repeater",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "min": 0,
   "max": 0,
   "layout": "table",
   "button_label": "Add Row"
  },
  "value": [
   {
    "field_monks_test_fields_repeater_label": "First row",
    "field_monks_test_fields_repeater_photo": "32"
   },
   {
    "field_monks_test_fields_repeater_label": "Second row",
    "field_monks_test_fields_repeater_photo": ""
   },
   {
    "field_monks_test_fields_repeater_label": "Third row, added live",
    "field_monks_test_fields_repeater_photo": "32"
   }
  ],
  "sub_fields": [
   {
    "key": "field_monks_test_fields_repeater_label",
    "name": "label",
    "label": "Label",
    "type": "text",
    "instructions": "",
    "required": true,
    "editable": true,
    "settings": {
     "default_value": "",
     "maxlength": "",
     "placeholder": "",
     "prepend": "",
     "append": ""
    }
   },
   {
    "key": "field_monks_test_fields_repeater_photo",
    "name": "photo",
    "label": "Photo",
    "type": "image",
    "instructions": "",
    "required": false,
    "editable": true,
    "settings": {
     "mime_types": ""
    }
   }
  ]
 },
 {
  "key": "field_monks_test_fields_gallery",
  "name": "monks_test_fields_gallery",
  "label": "Gallery",
  "type": "gallery",
  "instructions": "",
  "required": false,
  "editable": true,
  "settings": {
   "min": 0,
   "max": 0,
   "mime_types": ""
  },
  "value": [
   "32"
  ]
 },
 {
  "key": "field_monks_test_fields_oembed",
  "name": "monks_test_fields_oembed",
  "label": "Oembed",
  "type": "oembed",
  "instructions": "",
  "required": false,
  "editable": false,
  "settings": {},
  "value": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
 },
 {
  "key": "field_monks_test_fields_flexible_content",
  "name": "monks_test_fields_flexible_content",
  "label": "Flexible content",
  "type": "flexible_content",
  "instructions": "",
  "required": false,
  "editable": false,
  "settings": {
   "min": "",
   "max": "",
   "button_label": "Add Row"
  },
  "value": null
 },
 {
  "key": "field_monks_test_fields_clone",
  "name": "monks_test_fields_clone",
  "label": "Clone",
  "type": "clone",
  "instructions": "",
  "required": false,
  "editable": false,
  "settings": {},
  "value": null
 }
];
