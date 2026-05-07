pub fn greet(name: &str) -> String {
    format!("hello, {name}")
}

pub unsafe fn raw_copy(dst: *mut u8, src: *const u8, len: usize) {
    unsafe {
        std::ptr::copy_nonoverlapping(src, dst, len);
    }
}
