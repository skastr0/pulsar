pub fn sum_to(limit: u32) -> u32 {
    let mut total = 0;
    let mut i = 0;
    while i < limit {
        total += i;
        i += 1;
    }
    total
}

pub fn find_first_even(values: &[i32]) -> Option<i32> {
    for v in values {
        if v % 2 == 0 {
            return Some(*v);
        }
    }
    None
}

pub fn first_over(values: &[i32], limit: i32) -> Option<i32> {
    let mut index = 0;
    loop {
        if index >= values.len() {
            break None;
        }
        if values[index] > limit {
            break Some(values[index]);
        }
        index += 1;
    }
}
