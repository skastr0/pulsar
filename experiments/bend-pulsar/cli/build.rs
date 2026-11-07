//! Embeds the git sha of the checkout the CLI is built from (`PULSAR_GIT_SHA`), for `pulsar version`.
//! `PULSAR_BUILD_SHA` overrides it (a release build outside a checkout); without either it is
//! "unknown".

use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=PULSAR_BUILD_SHA");
    println!("cargo:rerun-if-changed=../../../.git/HEAD");
    let sha = std::env::var("PULSAR_BUILD_SHA").ok().filter(|s| !s.is_empty()).or_else(|| {
        let out = Command::new("git")
            .args(["-C", env!("CARGO_MANIFEST_DIR"), "rev-parse", "--short=12", "HEAD"])
            .output()
            .ok()
            .filter(|o| o.status.success())?;
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    });
    println!("cargo:rustc-env=PULSAR_GIT_SHA={}", sha.unwrap_or_else(|| "unknown".into()));
}
