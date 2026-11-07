pub fn grade(score: u32) -> char {
    if score >= 90 {
        'A'
    } else if score >= 70 {
        'B'
    } else {
        'C'
    }
}

pub fn describe(value: Option<i32>) -> String {
    if let Some(n) = value {
        format!("some {n}")
    } else {
        String::from("none")
    }
}

pub fn nested(flag: bool, n: i32) -> i32 {
    if flag {
        if n > 0 {
            1
        } else {
            0
        }
    } else {
        -1
    }
}
