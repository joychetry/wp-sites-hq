//! Monks Central core.

pub mod lock;
pub mod net;
pub mod paths;
pub mod store;
pub mod vault;

/// Version of the core, shared by the app and the CLI.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
