//! Language lanes: each adapter turns source files into facts through `crate::facts`.

pub mod bend;
pub mod functions;
pub mod rust;
pub mod ts;

use functions::FileFns;

/// One file's function rows from a lane, with ids local to the file. `tests` holds the local
/// indices of test functions (`TF`).
#[derive(Debug, Default)]
pub struct FileOut {
    pub fns: FileFns,
    pub tests: Vec<u32>,
}

pub mod scope;
