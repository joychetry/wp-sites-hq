//! `monks`: the Monks Central command line. A console program on every OS.

mod doctor;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use monks_core::{Core, ipc, paths, vault};

#[derive(Parser)]
#[command(name = "monks", version = monks_core::VERSION, about = "Monks Central from the command line")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the Monks Central core without a window, until Ctrl-C.
    Core,
    /// Ask the running core how it is.
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
        Command::Status => match ipc::call(&home, "status", serde_json::Value::Null).await {
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
    let core = match Core::start(&home).await {
        Ok(c) => c,
        Err(e) => return fail(e.to_string()),
    };
    println!(
        "Monks Central core {} is running for {}. Press Ctrl-C to stop.",
        monks_core::VERSION,
        core.home.display()
    );
    if let Err(e) = tokio::signal::ctrl_c().await {
        return fail(e.to_string());
    }
    ExitCode::SUCCESS
}

fn fail(msg: String) -> ExitCode {
    eprintln!("{msg}");
    ExitCode::FAILURE
}
