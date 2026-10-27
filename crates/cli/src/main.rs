//! `monks`: the Monks Central command line. A console program on every OS.

mod doctor;

use std::path::{Path, PathBuf};
use std::process::{ExitCode, Stdio};
use std::time::Duration;

use clap::{Parser, Subcommand};
use monks_core::ipc::ClientError;
use monks_core::{Core, Options, ipc, paths, vault};
use serde_json::Value;

#[derive(Parser)]
#[command(name = "monks", version = monks_core::VERSION, about = "Monks Central from the command line")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the Monks Central core without a window, until Ctrl-C or until
    /// the app takes over.
    Core,
    /// Ask the core how it is. Starts one in the background if none runs.
    Status,
    /// Check the data folder, database, keychain, core and network.
    Doctor {
        /// A site address to fetch over HTTPS, e.g. https://example.local
        url: Option<String>,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let home = match paths::data_dir() {
        Ok(h) => h,
        Err(e) => return fail(format!("Couldn't find the data folder: {e}")),
    };
    match cli.command {
        Command::Core => run_core(home).await,
        Command::Status => match call_or_start(&home, "status").await {
            Ok(s) => {
                println!(
                    "Monks Central {} is running (pid {}). This client is an {}.",
                    s["version"].as_str().unwrap_or("?"),
                    s["pid"],
                    s["role"].as_str().unwrap_or("?")
                );
                ExitCode::SUCCESS
            }
            Err(e) => fail(e.to_string()),
        },
        Command::Doctor { url } => {
            println!("Monks Central doctor ({})", monks_core::VERSION);
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
    let core = match Core::start(&home, Options { headless: true }).await {
        Ok(c) => c,
        Err(e) => return fail(e.to_string()),
    };
    println!(
        "Monks Central core {} is running for {}. Press Ctrl-C to stop.",
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
async fn call_or_start(home: &Path, method: &str) -> Result<Value, ClientError> {
    match ipc::call(home, method, Value::Null).await {
        Err(ClientError::NotRunning) => {}
        other => return other,
    }
    let exe = std::env::current_exe()?;
    spawn_headless(&exe, home)?;
    eprintln!("Started a Monks Central core in the background.");
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        match ipc::call(home, method, Value::Null).await {
            Err(ClientError::NotRunning) => continue,
            other => return other,
        }
    }
    Err(ClientError::NotRunning)
}

/// `monks core` for this data folder, detached so it outlives this command.
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
        use std::os::windows::process::CommandExt;
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
