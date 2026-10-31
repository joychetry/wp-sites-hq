// SPDX-License-Identifier: GPL-3.0-or-later
//! Block-safe body editing (plan Phase 3). WordPress block markup is read just
//! far enough to find the text inside simple blocks (paragraphs, headings, list
//! items). An edit replaces only that text, and the block comments with their
//! attributes must come out byte for byte the same, so no block can break.

use serde::Serialize;

/// Blocks whose text can be edited, and the HTML tags their text sits in.
const EDITABLE: &[(&str, &[&str])] = &[
    ("core/paragraph", &["p"]),
    ("core/heading", &["h1", "h2", "h3", "h4", "h5", "h6"]),
    ("core/list-item", &["li"]),
    ("core/preformatted", &["pre"]),
    ("core/verse", &["pre"]),
];

/// One block of a page body, in document order (nested blocks follow their parent).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Block {
    pub index: usize,
    /// `core/paragraph`, or empty for HTML outside any block (a classic body).
    pub name: String,
    pub depth: usize,
    pub editable: bool,
    /// Editable: the HTML inside the block's tag. Otherwise a short text preview.
    pub html: String,
    /// A heading's level (1 to 6), read from its tag; none for other blocks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    #[serde(skip)]
    span: (usize, usize),
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum BlockError {
    #[error(
        "WP Sites HQ can't read this body's blocks safely, so it won't change it. Edit it in WordPress."
    )]
    Unreadable,
    #[error("That block can't be edited here. Only text blocks can.")]
    NotEditable,
    #[error("Text can't contain block comments (<!-- -->).")]
    Comment,
    #[error("The edit would change the blocks, so it was not saved.")]
    Changed,
    #[error("A block can only be edited once in one save.")]
    Twice,
}

/// A block comment: `<!-- wp:name {attrs} -->`, `<!-- /wp:name -->` or `<!-- wp:name /-->`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Delim {
    start: usize,
    end: usize,
    closer: bool,
    void: bool,
    name: String,
    attrs: String,
}

fn name_char(c: u8) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-'
}

/// `[a-z][a-z0-9_-]*` from `i`, returning its end.
fn ident(b: &[u8], i: usize) -> Option<usize> {
    if !b.get(i)?.is_ascii_lowercase() {
        return None;
    }
    Some(
        (i + 1..b.len())
            .find(|&j| !name_char(b[j]))
            .unwrap_or(b.len()),
    )
}

fn spaces(b: &[u8], i: usize) -> usize {
    (i..b.len())
        .find(|&j| !b[j].is_ascii_whitespace())
        .unwrap_or(b.len())
}

/// `\s+/?-->` at `i`: (void, end).
fn tail(b: &[u8], i: usize) -> Option<(bool, usize)> {
    let j = spaces(b, i);
    if j == i {
        return None;
    }
    let (void, j) = if b.get(j) == Some(&b'/') {
        (true, j + 1)
    } else {
        (false, j)
    };
    b[j..].starts_with(b"-->").then_some((void, j + 3))
}

/// The delimiter starting at `start` (which holds `<!--`), as WordPress's parser reads it.
fn delimiter(s: &str, start: usize) -> Option<Delim> {
    let b = s.as_bytes();
    let mut i = spaces(b, start + 4);
    if i == start + 4 {
        return None;
    }
    let closer = b.get(i) == Some(&b'/');
    if closer {
        i += 1;
    }
    if !b[i..].starts_with(b"wp:") {
        return None;
    }
    let first = i + 3;
    let mut end = ident(b, first)?;
    let mut name = s[first..end].to_string();
    if b.get(end) == Some(&b'/') {
        let second = ident(b, end + 1)?;
        name = s[first..second].to_string();
        end = second;
    } else {
        name = format!("core/{name}");
    }
    // Attributes run to the first `}` that is followed by the end of the comment.
    let after = spaces(b, end);
    let (attrs, rest) = if after > end && b.get(after) == Some(&b'{') {
        let close = (after..b.len()).find(|&j| b[j] == b'}' && tail(b, j + 1).is_some())?;
        (s[after..=close].to_string(), close + 1)
    } else {
        (String::new(), end)
    };
    let (void, stop) = tail(b, rest)?;
    if closer && (void || !attrs.is_empty()) {
        return None;
    }
    Some(Delim {
        start,
        end: stop,
        closer,
        void,
        name,
        attrs,
    })
}

fn delimiters(s: &str) -> Vec<Delim> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(i) = s[from..].find("<!--").map(|i| i + from) {
        match delimiter(s, i) {
            Some(d) => {
                from = d.end;
                out.push(d);
            }
            None => from = i + 4,
        }
    }
    out
}

/// Text without tags, spaces collapsed, at most 80 characters.
fn preview(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(c),
            _ => {}
        }
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut out = words.join(" ");
    if out.chars().count() > 80 {
        out = out.chars().take(79).collect::<String>() + "…";
    }
    out
}

/// The span of the text inside `<tag ...>` … `</tag>` when the inner HTML is just that element.
fn text_span(s: &str, from: usize, to: usize, tags: &[&str]) -> Option<(usize, usize)> {
    let inner = &s[from..to];
    let lead = inner.len() - inner.trim_start().len();
    let body = inner.trim();
    let tag = tags.iter().find(|t| {
        body.strip_prefix('<')
            .and_then(|r| r.strip_prefix(**t))
            .is_some_and(|r| r.starts_with(['>', ' ', '\n', '\t']))
    })?;
    let open = body.find('>')? + 1;
    let end_tag = format!("</{tag}>");
    let close = body.rfind(&end_tag)?;
    (close >= open && body.len() == close + end_tag.len() && !body[open..close].contains(&end_tag))
        .then_some((from + lead + open, from + lead + close))
}

/// Every block of a body. A body with no block comments is one editable classic block.
pub fn parse(s: &str) -> Result<Vec<Block>, BlockError> {
    let delims = delimiters(s);
    if delims.is_empty() {
        return Ok(if s.trim().is_empty() {
            Vec::new()
        } else {
            vec![Block {
                index: 0,
                name: String::new(),
                depth: 0,
                editable: true,
                html: s.to_string(),
                level: None,
                span: (0, s.len()),
            }]
        });
    }
    let mut blocks: Vec<Block> = Vec::new();
    // (block position in `blocks`, opener, has nested blocks)
    let mut open: Vec<(usize, &Delim, bool)> = Vec::new();
    let mut last = 0;
    let freeform = |blocks: &mut Vec<Block>, from: usize, to: usize, depth: usize| {
        let text = preview(&s[from..to]);
        if depth == 0 && !text.is_empty() {
            blocks.push(Block {
                index: blocks.len(),
                name: String::new(),
                depth: 0,
                editable: false,
                html: text,
                level: None,
                span: (from, to),
            });
        }
    };
    for d in &delims {
        freeform(&mut blocks, last, d.start, open.len());
        last = d.end;
        if d.closer {
            let (at, opener, nested) = open.pop().ok_or(BlockError::Unreadable)?;
            if opener.name != d.name {
                return Err(BlockError::Unreadable);
            }
            let b = &mut blocks[at];
            b.span = (opener.end, d.start);
            let tags = EDITABLE.iter().find(|(n, _)| *n == d.name).map(|(_, t)| *t);
            match tags.and_then(|t| text_span(s, opener.end, d.start, t)) {
                Some((from, to)) if !nested => {
                    b.editable = true;
                    b.html = s[from..to].to_string();
                    b.span = (from, to);
                    // "<h3 ...>": the digit after "<h".
                    if d.name == "core/heading" {
                        b.level = s[opener.end..from]
                            .trim_start()
                            .as_bytes()
                            .get(2)
                            .filter(|c| c.is_ascii_digit())
                            .map(|c| c - b'0');
                    }
                }
                _ if !nested => b.html = preview(&s[opener.end..d.start]),
                _ => {}
            }
        } else {
            if let Some(parent) = open.last_mut() {
                parent.2 = true;
            }
            blocks.push(Block {
                index: blocks.len(),
                name: d.name.clone(),
                depth: open.len(),
                editable: false,
                html: String::new(),
                level: None,
                span: (d.start, d.end),
            });
            if !d.void {
                open.push((blocks.len() - 1, d, false));
            }
        }
    }
    if !open.is_empty() {
        return Err(BlockError::Unreadable);
    }
    freeform(&mut blocks, last, s.len(), 0);
    Ok(blocks)
}

/// The block comments of a body, in order: what must never change.
pub fn skeleton(s: &str) -> Vec<(bool, bool, String, String)> {
    delimiters(s)
        .into_iter()
        .map(|d| (d.closer, d.void, d.name, d.attrs))
        .collect()
}

/// Replace the text of editable blocks (`index`, new HTML). The block comments
/// are checked to be unchanged before the new body is returned.
pub fn apply(s: &str, edits: &[(usize, String)]) -> Result<String, BlockError> {
    let blocks = parse(s)?;
    let mut spans = Vec::with_capacity(edits.len());
    for (index, html) in edits {
        let b = blocks
            .iter()
            .find(|b| b.index == *index)
            .filter(|b| b.editable)
            .ok_or(BlockError::NotEditable)?;
        // A classic body has no blocks to protect, so only block bodies refuse comments.
        if !b.name.is_empty() && (html.contains("<!--") || html.contains("-->")) {
            return Err(BlockError::Comment);
        }
        // Two edits to one block would cut the body at a place the first edit moved.
        if spans.iter().any(|(span, _)| *span == b.span) {
            return Err(BlockError::Twice);
        }
        spans.push((b.span, html.as_str()));
    }
    spans.sort_by_key(|(span, _)| std::cmp::Reverse(span.0));
    let mut out = s.to_string();
    for ((from, to), html) in spans {
        out.replace_range(from..to, html);
    }
    if !blocks.iter().all(|b| b.name.is_empty()) && skeleton(&out) != skeleton(s) {
        return Err(BlockError::Changed);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "<!-- wp:heading {\"level\":2} -->\n<h2 class=\"wp-block-heading\">Our <em>menu</em></h2>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>Fresh bread daily.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:group {\"layout\":{\"type\":\"constrained\"}} -->\n<div class=\"wp-block-group\"><!-- wp:paragraph {\"align\":\"center\"} -->\n<p class=\"has-text-align-center\">Open 7 to 3.</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->\n\n<!-- wp:image {\"id\":12,\"sizeSlug\":\"large\"} -->\n<figure class=\"wp-block-image size-large\"><img src=\"a.jpg\" alt=\"\" class=\"wp-image-12\"/><figcaption>The shop</figcaption></figure>\n<!-- /wp:image -->\n\n<!-- wp:list -->\n<ul class=\"wp-block-list\"><!-- wp:list-item -->\n<li>Rye</li>\n<!-- /wp:list-item --></ul>\n<!-- /wp:list -->\n\n<!-- wp:spacer {\"height\":\"20px\"} /-->\n\n<!-- wp:acme/map {\"zoom\":3,\"note\":\"a } b\"} -->\n<div>map</div>\n<!-- /wp:acme/map -->";

    fn names(b: &[Block]) -> Vec<(&str, usize, bool)> {
        b.iter()
            .map(|b| (b.name.as_str(), b.depth, b.editable))
            .collect()
    }

    #[test]
    fn a_block_page_is_read_in_order_with_its_text_blocks_editable() {
        let b = parse(PAGE).unwrap();
        assert_eq!(
            names(&b),
            vec![
                ("core/heading", 0, true),
                ("core/paragraph", 0, true),
                ("core/group", 0, false),
                ("core/paragraph", 1, true),
                ("core/image", 0, false),
                ("core/list", 0, false),
                ("core/list-item", 1, true),
                ("core/spacer", 0, false),
                ("acme/map", 0, false),
            ]
        );
        assert_eq!(b[0].html, "Our <em>menu</em>");
        assert_eq!(
            (b[0].level, b[1].level),
            (Some(2), None),
            "a heading knows its level"
        );
        assert_eq!(b[3].html, "Open 7 to 3.");
        assert_eq!(b[4].html, "The shop", "a locked block shows its text");
        assert_eq!(b[6].html, "Rye");
        assert!(b.iter().enumerate().all(|(i, b)| b.index == i));
    }

    #[test]
    fn an_edit_changes_only_that_text_and_keeps_every_block_comment() {
        let out = apply(
            PAGE,
            &[(1, "Bread at 7.".into()), (3, "Open <b>7</b> to 4.".into())],
        )
        .unwrap();
        assert_eq!(
            out,
            PAGE.replace("Fresh bread daily.", "Bread at 7.")
                .replace("Open 7 to 3.", "Open <b>7</b> to 4.")
        );
        assert_eq!(skeleton(&out), skeleton(PAGE));
        assert_eq!(apply(PAGE, &[]).unwrap(), PAGE, "no edits, same body");
    }

    #[test]
    fn edits_that_could_break_blocks_are_refused() {
        assert_eq!(
            apply(PAGE, &[(4, "x".into())]),
            Err(BlockError::NotEditable),
            "image"
        );
        assert_eq!(
            apply(PAGE, &[(2, "x".into())]),
            Err(BlockError::NotEditable),
            "group"
        );
        assert_eq!(
            apply(PAGE, &[(99, "x".into())]),
            Err(BlockError::NotEditable)
        );
        assert_eq!(
            apply(PAGE, &[(1, "ééé".into()), (1, "x".into())]),
            Err(BlockError::Twice),
            "one block, two edits"
        );
        assert_eq!(
            apply(PAGE, &[(1, "a <!-- /wp:paragraph --> b".into())]),
            Err(BlockError::Comment)
        );
        assert_eq!(
            apply(PAGE, &[(1, "a --> b".into())]),
            Err(BlockError::Comment)
        );
    }

    #[test]
    fn a_classic_body_is_one_editable_block() {
        let b = parse("<p>Hello</p>\n<p>World</p>").unwrap();
        assert_eq!(names(&b), vec![("", 0, true)]);
        assert_eq!(
            apply("<p>Hello</p>", &[(0, "<p>Hi <!-- note --></p>".into())]).unwrap(),
            "<p>Hi <!-- note --></p>"
        );
        assert!(parse("  \n").unwrap().is_empty());
    }

    #[test]
    fn broken_markup_is_not_touched() {
        for bad in [
            "<!-- wp:paragraph --><p>a</p>",
            "<p>a</p><!-- /wp:paragraph -->",
            "<!-- wp:group --><!-- wp:paragraph --><p>a</p><!-- /wp:group --><!-- /wp:paragraph -->",
        ] {
            assert_eq!(parse(bad), Err(BlockError::Unreadable), "{bad}");
            assert_eq!(apply(bad, &[]), Err(BlockError::Unreadable));
        }
    }

    #[test]
    fn delimiters_are_read_as_wordpress_reads_them() {
        let s = "<!-- not a block --><!--wp:paragraph --><!-- wp:Paragraph --><!-- wp:x/ -->\
                 <!-- wp:a/b {\"k\":\"}\"} /--><!-- /wp:a {\"x\":1} -->";
        let sk = skeleton(s);
        assert_eq!(
            sk,
            vec![(false, true, "a/b".into(), "{\"k\":\"}\"}".into())],
            "only the void block with attributes is a delimiter"
        );
        let b = parse("<!-- wp:paragraph --><div>not a p</div><!-- /wp:paragraph -->").unwrap();
        assert!(!b[0].editable, "text outside the expected tag is locked");
        assert_eq!(b[0].html, "not a p");
        let b = parse("x<!-- wp:paragraph --><p>a</p><p>b</p><!-- /wp:paragraph -->y").unwrap();
        assert_eq!(
            names(&b),
            vec![("", 0, false), ("core/paragraph", 0, false), ("", 0, false)]
        );
        assert_eq!(preview(&"word ".repeat(40)).chars().count(), 80);
    }
}
