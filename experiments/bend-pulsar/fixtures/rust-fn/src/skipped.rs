pub fn macro_hides_if(flag: bool) -> bool {
    assert!(flag || !flag);
    flag
}

#[cfg(test)]
pub fn test_only_helper() -> i32 {
    1
}

#[cfg(test)]
mod tests {
    #[test]
    fn runs_only_under_test() {
        assert_eq!(super::test_only_helper(), 1);
    }
}
