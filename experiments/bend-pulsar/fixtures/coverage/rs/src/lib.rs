pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

pub fn classify(n: i32) -> &'static str {
    if n > 0 {
        "positive"
    } else if n < 0 {
        "negative"
    } else {
        "zero"
    }
}

pub fn unreached() -> i32 {
    42
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds() {
        assert_eq!(add(1, 2), 3);
    }

    #[test]
    fn classifies_positive_only() {
        assert_eq!(classify(1), "positive");
    }
}
