//! Monks Central core.

pub mod store;

/// Version of the core, shared by the app and the CLI.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
