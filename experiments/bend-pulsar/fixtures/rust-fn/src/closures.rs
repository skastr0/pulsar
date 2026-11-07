pub fn doubled(values: &[i32]) -> Vec<i32> {
    values.iter().map(|v| v * 2).collect()
}

pub fn adder(base: i32) -> impl Fn(i32) -> i32 {
    move |n| n + base
}

pub fn nested_closures() -> i32 {
    let outer = |a: i32| {
        let inner = |b: i32| b * 2;
        inner(a) + 1
    };
    outer(3)
}
