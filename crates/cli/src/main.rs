// SPDX-License-Identifier: GPL-3.0-or-later
//! `wpshq`: the WP Sites HQ command line. A console program on every OS.
//! Installers also ship it as `monks`, its name before 0.4.0, until 1.0.

mod doctor;
mod mcp;

use std::path::{Path, PathBuf};
use std::process::{ExitCode, Stdio};
use std::time::Duration;

use clap::{Parser, Subcommand};
use monks_core::ipc::ClientError;
use monks_core::{Core, Options, ipc, paths, vault};
use serde_json::Value;

#[derive(Parser)]
#[command(name = "wpshq", version = monks_core::VERSION, about = "WP Sites HQ from the command line")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the WP Sites HQ core without a window, until Ctrl-C or until
    /// the app takes over.
    Core,
    /// Ask the core how it is. Starts one in the background if none runs.
    Status,
    /// Run one Classic Monks tool on a site, as an agent: tools that only read
    /// work; changes are made in the app, where you confirm them.
    Run {
        /// The site's address, name or number.
        site: String,
        /// The tool, e.g. get-site-snapshot.
        tool: String,
        /// The tool's arguments as JSON, e.g. '{"plugin":"akismet/akismet.php"}'.
        #[arg(default_value = "{}")]
        arguments: String,
    },
    /// Serve MCP on stdin and stdout for an AI app (Claude, Cursor, VS Code):
    /// every site through one server, as an agent. Changes on many sites wait
    /// for you to confirm them in the app.
    Mcp,
    /// Check the data folder, database, keychain, core and network.
    Doctor {
        /// A site address to fetch over HTTPS, e.g. https://example.local
        url: Option<String>,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    let mut args = std::env::args_os();
    let called_monks = args
        .next()
        .and_then(|a| Path::new(&a).file_stem().map(|s| s == "monks"))
        .unwrap_or(false);
    // Never for mcp: AI apps show stderr as server errors.
    if called_monks && args.next().is_none_or(|a| a != "mcp") {
        eprintln!("`monks` is now `wpshq`. The old name works until 1.0.");
    }
    let cli = Cli::parse();
    let home = match paths::data_dir() {
        Ok(h) => h,
        Err(e) => return fail(format!("Couldn't find the data folder: {e}")),
    };
    match cli.command {
        Command::Core => run_core(home).await,
        Command::Status => match call_or_start(&home, "status", Value::Null).await {
            Ok(s) => {
                println!(
                    "WP Sites HQ {} is running (pid {}). This client is an {}.",
                    s["version"].as_str().unwrap_or("?"),
                    s["pid"],
                    s["role"].as_str().unwrap_or("?")
                );
                ExitCode::SUCCESS
            }
            Err(e) => fail(e.to_string()),
        },
        Command::Run {
            site,
            tool,
            arguments,
        } => {
            let Ok(arguments) = serde_json::from_str::<Value>(&arguments) else {
                return fail(format!("The arguments aren't JSON: {arguments}"));
            };
            let params = serde_json::json!({ "site": site, "tool": tool, "arguments": arguments });
            match call_or_start(&home, "site.run", params).await {
                Ok(v) => {
                    println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
                    ExitCode::SUCCESS
                }
                Err(e) => fail(e.to_string()),
            }
        }
        Command::Mcp => {
            let call = |method: &'static str, params: Value| {
                let home = home.clone();
                async move { call_or_start(&home, method, params).await }
            };
            match mcp::serve(call).await {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => fail(e.to_string()),
            }
        }
        Command::Doctor { url } => {
            println!("WP Sites HQ doctor ({})", monks_core::VERSION);
            let keychain = vault::os_keychain();
            let kc = keychain.as_deref().map_err(|e| e.to_string());
            let checks = doctor::run(&home, kc, url.as_deref()).await;
            for c in &checks {
                println!("{c}");
            }
            if checks.iter().any(|c| c.level == doctor::Level::Fail) {
                println!("Some checks failed.");
                ExitCode::FAILURE
            } else {
                println!("All checks passed.");
                ExitCode::SUCCESS
            }
        }
    }
}

async fn run_core(home: PathBuf) -> ExitCode {
    let opts = Options {
        headless: true,
        keychain: vault::os_keychain().map_err(|e| e.to_string()),
        ..Default::default()
    };
    let core = match Core::start(&home, opts).await {
        Ok(c) => c,
        Err(e) => return fail(e.to_string()),
    };
    // Renew every grant, then check sites every 15 minutes.
    core.start_background();
    println!(
        "WP Sites HQ core {} is running for {}. Press Ctrl-C to stop.",
        monks_core::VERSION,
        core.home.display()
    );
    tokio::select! {
        r = tokio::signal::ctrl_c() => if let Err(e) = r { return fail(e.to_string()) },
        () = core.shutdown_requested() => println!("Asked to stop (the app is taking over)."),
    }
    core.finish().await;
    ExitCode::SUCCESS
}

/// Call the core; if none runs, start a headless one in the background first.
async fn call_or_start(home: &Path, method: &str, params: Value) -> Result<Value, ClientError> {
    match ipc::call(home, method, params.clone()).await {
        Err(ClientError::NotRunning) => {}
        other => return other,
    }
    let exe = std::env::current_exe()?;
    spawn_headless(&exe, home)?;
    eprintln!("Started a WP Sites HQ core in the background.");
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        match ipc::call(home, method, params.clone()).await {
            Err(ClientError::NotRunning) => continue,
            other => return other,
        }
    }
    Err(ClientError::NotRunning)
}

/// `wpshq core` for this data folder, detached so it outlives this command.
fn spawn_headless(exe: &Path, home: &Path) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("core")
        .env("MONKS_HOME", home)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group: Ctrl-C in this terminal doesn't stop it.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::Foundation::{HANDLE_FLAG_INHERIT, SetHandleInformation};
        // Windows children inherit every inheritable handle, Stdio::null or not: our own
        // stdout pipe would stay open in the core and hang whoever reads this command.
        for h in [
            std::io::stdin().as_raw_handle(),
            std::io::stdout().as_raw_handle(),
            std::io::stderr().as_raw_handle(),
        ] {
            // A missing handle just fails; nothing to undo.
            unsafe { SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0) };
        }
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(drop)
}

fn fail(msg: String) -> ExitCode {
    eprintln!("{msg}");
    ExitCode::FAILURE
}
