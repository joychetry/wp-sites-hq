// SPDX-License-Identifier: GPL-3.0-or-later
//! Plugin bundles (a named set installed together) and installing a plugin or
//! theme from a zip on this computer (Classic Monks M8, `install-zip`).
//!
//! A zip is copied into the data folder first ("staged") and a job names it by
//! its SHA-256, so a plan holds no file paths and an agent can't point one at
//! an arbitrary file.

use std::path::PathBuf;

use base64::Engine;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::Core;
use crate::connect::{SiteError, plain};
use crate::fleet::has_tool;
use crate::sites::Mode;

/// The largest zip Monks Central sends.
pub const MAX_ZIP: usize = 64 * 1024 * 1024;
/// Bytes per `install-zip` call, well under the site's 2 MB and post_max_size.
const CHUNK: usize = 1024 * 1024;
/// Staged zips older than this are deleted.
const KEEP_SECS: u64 = 7 * 86_400;

pub const NEEDS_CM_ZIP: &str =
    "Installing from a zip needs Classic Monks on the site. This site is in Basic mode.";
pub const ALREADY_THERE: &str = "It's already installed on this site. To put this copy in its place, install it again with \u{201c}Replace it where it's already installed\u{201d} ticked.";
pub const OLD_CM_ZIP: &str = "This site's Classic Monks can't install from a zip yet. Update Classic Monks on the site, then check it again.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BundlePlugin {
    /// A WordPress.org slug, or an https link to a zip.
    pub source: String,
    /// What to call it; the slug when empty.
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bundle {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    pub plugins: Vec<BundlePlugin>,
}

/// A zip copied into the data folder, ready for a job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Staged {
    /// `<sha256>.zip`, what a job's action names.
    pub file: String,
    /// The name it had on this computer.
    pub name: String,
    pub size: usize,
}

fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn check_bundle(b: &Bundle) -> Result<Bundle, SiteError> {
    let name = b.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(plain("Give the bundle a name of up to 80 characters."));
    }
    if b.plugins.is_empty() || b.plugins.len() > 50 {
        return Err(plain("A bundle holds 1 to 50 plugins."));
    }
    let mut plugins = Vec::new();
    for p in &b.plugins {
        let source = p.source.trim();
        if !is_slug(source) && !source.starts_with("https://") {
            return Err(plain(format!(
                "{source} isn't a WordPress.org slug (like woocommerce) or an https link to a zip."
            )));
        }
        if !plugins.iter().any(|x: &BundlePlugin| x.source == source) {
            plugins.push(BundlePlugin {
                source: source.into(),
                name: p.name.trim().into(),
            });
        }
    }
    Ok(Bundle {
        id: b.id,
        name: name.into(),
        plugins,
    })
}

/// `<64 hex>.zip`, the only names a job may give.
fn is_staged_name(file: &str) -> bool {
    file.len() == 68
        && file.ends_with(".zip")
        && file[..64]
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The site's words for a finished install.
fn installed_message(out: &Value, name: &str) -> String {
    let what = out["name"]
        .as_str()
        .filter(|n| !n.is_empty())
        .unwrap_or(name);
    let version = out["version"]
        .as_str()
        .map(|v| format!(" {v}"))
        .unwrap_or_default();
    let verb = if out["replaced"] == true {
        "Replaced with"
    } else {
        "Installed"
    };
    let on = if out["activated"] == true {
        " and turned it on"
    } else {
        ""
    };
    format!("{verb} {what}{version}{on}.")
}

impl Core {
    fn zips(&self) -> PathBuf {
        self.home.join("zips")
    }

    pub fn bundles(&self) -> Result<Vec<Bundle>, SiteError> {
        self.db(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT id, name, plugins FROM bundles ORDER BY name COLLATE NOCASE",
            )?;
            stmt.query_map([], |r| {
                let plugins: String = r.get(2)?;
                Ok(Bundle {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    plugins: serde_json::from_str(&plugins).unwrap_or_default(),
                })
            })?
            .collect()
        })
    }

    /// Add a bundle (id 0) or change one.
    pub fn save_bundle(&self, b: &Bundle) -> Result<Bundle, SiteError> {
        let b = check_bundle(b)?;
        let plugins = serde_json::to_string(&b.plugins).expect("plain list");
        let id = self.db(|c| {
            let taken: Option<i64> = c
                .query_row(
                    "SELECT id FROM bundles WHERE name = ?1 AND id != ?2",
                    params![b.name, b.id],
                    |r| r.get(0),
                )
                .optional()?;
            if taken.is_some() {
                return Ok(None);
            }
            if b.id == 0 {
                c.execute(
                    "INSERT INTO bundles (name, plugins) VALUES (?1, ?2)",
                    params![b.name, plugins],
                )?;
                return Ok(Some(c.last_insert_rowid()));
            }
            let n = c.execute(
                "UPDATE bundles SET name = ?2, plugins = ?3 WHERE id = ?1",
                params![b.id, b.name, plugins],
            )?;
            Ok((n == 1).then_some(b.id))
        })?;
        let id = id.ok_or_else(|| {
            plain(format!(
                "There is already a bundle called {}, or this one was deleted.",
                b.name
            ))
        })?;
        Ok(Bundle { id, ..b })
    }

    pub fn delete_bundle(&self, id: i64) -> Result<(), SiteError> {
        self.db(|c| c.execute("DELETE FROM bundles WHERE id = ?1", [id]))?;
        Ok(())
    }

    /// Keep a zip from this computer for an install job. The same file twice
    /// is stored once.
    pub fn stage_zip(&self, name: &str, bytes: &[u8]) -> Result<Staged, SiteError> {
        if bytes.len() > MAX_ZIP {
            return Err(plain("The zip is larger than 64 MB."));
        }
        if !bytes.starts_with(b"PK\x03\x04") {
            return Err(plain(format!("{name} isn't a zip file.")));
        }
        let dir = self.zips();
        let io = |e: std::io::Error| {
            plain(format!(
                "Couldn't keep the zip in Monks Central's folder: {e}"
            ))
        };
        crate::paths::ensure_private_dir(&dir).map_err(io)?;
        // Old staged zips go first, so the folder doesn't grow forever.
        for e in std::fs::read_dir(&dir).map_err(io)?.flatten() {
            let old = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age.as_secs() > KEEP_SECS);
            if old {
                let _ = std::fs::remove_file(e.path());
            }
        }
        let hex: String = Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let file = format!("{hex}.zip");
        std::fs::write(dir.join(&file), bytes).map_err(io)?;
        let name: String = name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(name)
            .chars()
            .filter(|c| !c.is_control())
            .take(120)
            .collect();
        Ok(Staged {
            file,
            name,
            size: bytes.len(),
        })
    }

    /// `stage_zip` for the window, which sends the file as base64.
    pub fn stage_zip_base64(&self, name: &str, data: &str) -> Result<Staged, SiteError> {
        if data.len() > MAX_ZIP / 3 * 4 + 4 {
            return Err(plain("The zip is larger than 64 MB."));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| plain("The file didn't arrive whole. Choose it again."))?;
        self.stage_zip(name, &bytes)
    }

    /// Send a staged zip to the site in chunks; the last one installs it.
    pub(crate) async fn install_zip(
        &self,
        id: i64,
        file: &str,
        name: &str,
        kind: &str,
        activate: bool,
        overwrite: bool,
    ) -> Result<String, SiteError> {
        let site = self.site(id)?;
        if site.mode == Mode::Basic {
            return Err(plain(NEEDS_CM_ZIP));
        }
        if !has_tool(&site, "install-zip") {
            return Err(plain(OLD_CM_ZIP));
        }
        if !is_staged_name(file) || !matches!(kind, "plugin" | "theme") {
            return Err(plain(
                "That zip isn't one Monks Central kept for installing.",
            ));
        }
        let bytes = std::fs::read(self.zips().join(file)).map_err(|_| {
            plain("The zip isn't in Monks Central any more (zips are kept a week). Choose the file again.")
        })?;
        let b64 = base64::engine::general_purpose::STANDARD;
        let chunks: Vec<&[u8]> = bytes.chunks(CHUNK).collect();
        let mut upload: Option<String> = None;
        let mut offset = 0;
        for (i, chunk) in chunks.iter().enumerate() {
            let last = i + 1 == chunks.len();
            let mut args = json!({ "data": b64.encode(chunk), "done": last });
            match &upload {
                None => {
                    args["filename"] = name.into();
                    args["kind"] = kind.into();
                    args["overwrite"] = overwrite.into();
                    args["activate"] = activate.into();
                }
                Some(u) => {
                    args["upload_id"] = u.as_str().into();
                    args["offset"] = offset.into();
                }
            }
            let out = match self.call_ability_inner(id, "install-zip", args).await {
                // The site words this for agents; a person ticks a box instead.
                Err(e) if e.to_string().contains("overwrite: true") => {
                    return Err(plain(ALREADY_THERE));
                }
                r => r?,
            };
            offset += chunk.len();
            if last {
                return Ok(installed_message(&out, name));
            }
            upload = out["upload_id"].as_str().map(String::from);
            if upload.is_none() {
                return Err(plain("The site didn't start the upload. Try again."));
            }
        }
        Err(plain("The zip is empty."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::fleet::{Action, Change, ItemState};
    use crate::testsite::TestSite;
    use std::sync::Arc;
    use std::time::Duration;

    async fn core() -> (tempfile::TempDir, Arc<Core>) {
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        (home, core)
    }

    fn browser(url: &str) -> std::io::Result<()> {
        let url = url.to_string();
        tokio::spawn(async move { reqwest::get(url).await });
        Ok(())
    }

    #[tokio::test]
    async fn bundles_are_kept_and_checked() {
        let (_h, core) = core().await;
        let p = |s: &str| BundlePlugin {
            source: s.into(),
            name: String::new(),
        };
        let shop = core
            .save_bundle(&Bundle {
                id: 0,
                name: " Shop ".into(),
                plugins: vec![
                    p("woocommerce"),
                    p(" woocommerce"),
                    p("https://x.test/a.zip"),
                ],
            })
            .unwrap();
        assert_eq!((shop.name.as_str(), shop.plugins.len()), ("Shop", 2));
        let blog = core
            .save_bundle(&Bundle {
                id: 0,
                name: "Blog".into(),
                plugins: vec![p("akismet")],
            })
            .unwrap();
        assert_eq!(core.bundles().unwrap(), vec![blog.clone(), shop.clone()]);
        let renamed = core.save_bundle(&Bundle {
            name: "blog".into(),
            ..shop.clone()
        });
        assert!(
            renamed
                .unwrap_err()
                .to_string()
                .contains("already a bundle")
        );
        for (bad, why) in [
            (
                Bundle {
                    name: "".into(),
                    ..shop.clone()
                },
                "name",
            ),
            (
                Bundle {
                    plugins: vec![],
                    ..shop.clone()
                },
                "1 to 50",
            ),
            (
                Bundle {
                    plugins: vec![p("Not A Slug")],
                    ..shop.clone()
                },
                "isn't a WordPress.org slug",
            ),
            (
                Bundle {
                    plugins: vec![p("http://x.test/a.zip")],
                    ..shop.clone()
                },
                "https link",
            ),
            (
                Bundle {
                    id: 99,
                    ..shop.clone()
                },
                "deleted",
            ),
        ] {
            let e = core.save_bundle(&bad).unwrap_err().to_string();
            assert!(e.contains(why), "{why}: {e}");
        }
        core.delete_bundle(blog.id).unwrap();
        assert_eq!(core.bundles().unwrap(), vec![shop]);
    }

    #[tokio::test]
    async fn a_zip_installs_in_chunks_on_classic_monks_only() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let basic = TestSite::start().await;
        let b = core
            .add_site_basic(&basic.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap();

        assert!(
            core.stage_zip("x.zip", b"not a zip")
                .unwrap_err()
                .to_string()
                .contains("isn't a zip")
        );
        assert!(
            core.stage_zip_base64("x.zip", "%%")
                .unwrap_err()
                .to_string()
                .contains("whole")
        );
        assert_eq!(core.stage_zip_base64("y.zip", "UEsDBAA=").unwrap().size, 5);
        let mut zip = b"PK\x03\x04".to_vec();
        zip.resize(CHUNK * 2 + 10, 7);
        let staged = core
            .stage_zip("/home/me/Downloads/mc-hello.zip", &zip)
            .unwrap();
        assert_eq!(
            (staged.name.as_str(), staged.size),
            ("mc-hello.zip", zip.len())
        );
        assert!(is_staged_name(&staged.file));
        assert_eq!(
            core.stage_zip("again.zip", &zip).unwrap().file,
            staged.file,
            "same bytes, same file"
        );

        let install = Action::InstallZip {
            file: staged.file.clone(),
            name: staged.name.clone(),
            kind: "plugin".into(),
            activate: true,
            overwrite: false,
        };
        let job = core
            .start_job(
                "Install mc-hello.zip",
                vec![
                    Change {
                        site_id: s.id,
                        action: install.clone(),
                    },
                    Change {
                        site_id: b.id,
                        action: install.clone(),
                    },
                ],
            )
            .await
            .unwrap();
        assert_eq!(job.items[0].label, "Install mc-hello.zip");
        let job = wait(&core, job.id).await;
        assert_eq!(
            job.items[0].state,
            ItemState::Done,
            "{}",
            job.items[0].message
        );
        assert_eq!(
            job.items[0].message,
            "Installed MC Hello 1.0 and turned it on."
        );
        assert_eq!(
            (job.items[1].state, job.items[1].message.as_str()),
            (ItemState::Failed, NEEDS_CM_ZIP)
        );
        let calls: Vec<Value> = site
            .state()
            .calls
            .iter()
            .filter(|(t, _)| t == "install-zip")
            .map(|(_, a)| a.clone())
            .collect();
        assert_eq!(calls.len(), 3, "three chunks");
        assert_eq!(
            (calls[0]["kind"].as_str(), calls[0]["done"].as_bool()),
            (Some("plugin"), Some(false))
        );
        assert_eq!(
            (calls[2]["offset"].as_u64(), calls[2]["done"].as_bool()),
            (Some(CHUNK as u64 * 2), Some(true))
        );
        assert!(
            site.state()
                .plugins
                .iter()
                .any(|p| p["plugin"] == "mc-hello/mc-hello.php")
        );

        // Again: refused in plain words, then replaced when asked to.
        let e = core
            .install_zip(s.id, &staged.file, "mc-hello.zip", "plugin", false, false)
            .await
            .unwrap_err();
        assert_eq!(e.to_string(), ALREADY_THERE);
        let replaced = core
            .install_zip(s.id, &staged.file, "mc-hello.zip", "plugin", false, true)
            .await
            .unwrap();
        assert!(
            replaced.starts_with("Replaced with MC Hello 1.0"),
            "{replaced}"
        );

        // A file that isn't staged, or an older Classic Monks, is refused.
        let e = core
            .install_zip(s.id, "../../etc/passwd", "x.zip", "plugin", false, false)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("isn't one Monks Central kept"));
        let gone = format!("{}.zip", "0".repeat(64));
        let e = core
            .install_zip(s.id, &gone, "x.zip", "theme", false, true)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("Choose the file again"));
        site.state().no_zip_tool = true;
        core.check_site(s.id).await;
        let e = core
            .install_zip(s.id, &staged.file, "x.zip", "plugin", false, false)
            .await
            .unwrap_err();
        assert_eq!(e.to_string(), OLD_CM_ZIP);
        assert_eq!(
            installed_message(&json!({ "replaced": true, "version": "2.0" }), "a.zip"),
            "Replaced with a.zip 2.0."
        );
    }

    async fn wait(core: &Core, job: i64) -> crate::fleet::Job {
        for _ in 0..200 {
            let j = core.job(job).unwrap();
            if j.finished_at.is_some() {
                return j;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("job {job} didn't finish");
    }
}
