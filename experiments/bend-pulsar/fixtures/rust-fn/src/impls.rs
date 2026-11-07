pub struct Counter {
    value: i32,
}

impl Counter {
    pub fn new() -> Self {
        Self { value: 0 }
    }

    pub fn bump(&mut self, by: i32) -> i32 {
        self.value += by;
        self.value
    }
}

pub trait Reset {
    fn reset(&mut self);
}

impl Reset for Counter {
    fn reset(&mut self) {
        self.value = 0;
    }
}

pub async fn fetch_len(_url: &str) -> usize {
    0
}

pub fn generic_first<T: Clone>(items: &[T]) -> Option<T> {
    items.first().cloned()
}

pub struct Meters(pub f64);

impl From<f64> for Meters {
    fn from(value: f64) -> Self {
        Meters(value)
    }
}

impl From<i32> for Meters {
    fn from(value: i32) -> Self {
        Meters(value as f64)
    }
}
