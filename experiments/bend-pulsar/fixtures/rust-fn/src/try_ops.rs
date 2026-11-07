pub fn first_number(text: &str) -> Result<i32, std::num::ParseIntError> {
    let first = text
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
        .parse::<i32>()?;
    Ok(first)
}

pub fn second_number(text: &str) -> Result<i32, std::num::ParseIntError> {
    let mut parts = text.split(',');
    let _ = parts.next();
    let second = parts.next().unwrap_or("").trim().parse::<i32>()?;
    Ok(second)
}

pub fn checked_div(a: i32, b: i32) -> Option<i32> {
    if b == 0 {
        return None;
    }
    Some(a / b)
}
