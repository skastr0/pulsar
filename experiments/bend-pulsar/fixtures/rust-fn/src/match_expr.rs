pub enum Shape {
    Circle(f64),
    Square(f64),
}

pub fn area(shape: &Shape) -> f64 {
    match shape {
        Shape::Circle(radius) => 3.14 * radius * radius,
        Shape::Square(side) => side * side,
    }
}

pub fn label(n: u32) -> &'static str {
    match n {
        0 => "zero",
        1 => "one",
        _ => "many",
    }
}

pub fn guarded(n: i32) -> &'static str {
    match n {
        n if n < 0 => "negative",
        0 => "zero",
        _ => "positive",
    }
}
