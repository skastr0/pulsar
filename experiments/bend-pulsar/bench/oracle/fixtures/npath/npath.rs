// NPath fixtures — same hand-computed Nejmeh 1988 expectations as
// npath.ts (see that file's header for the recurrences used).

fn foo() {}
fn bar() {}
fn baz() {}
fn qux() {}

pub fn straight(x: i32) -> i32 {
    x + 1
}

pub fn one_if(c: bool) {
    if c {
        foo();
    }
}

pub fn if_else(c: bool) {
    if c {
        foo();
    } else {
        bar();
    }
}

pub fn two_ifs(c: bool, d: bool) {
    if c {
        foo();
    }
    if d {
        bar();
    }
}

pub fn nested_if(c: bool, d: bool) {
    if c {
        if d {
            foo();
        }
    } else {
        bar();
    }
}

pub fn and_pred(a: bool, b: bool) {
    if a && b {
        foo();
    }
}

pub fn while_and(a: bool, b: bool) {
    while a && b {
        foo();
    }
}

pub fn match3(x: i32) {
    match x {
        1 => foo(),
        2 => bar(),
        _ => baz(),
    }
}

pub fn while_loop(c: bool) {
    while c {
        foo();
    }
}

pub fn for_loop() {
    for i in 0..10 {
        foo();
    }
}

pub fn guard_return(c: bool) {
    if !c {
        return;
    }
    foo();
    bar();
}

pub fn deep_nest(a: bool, b: bool, c: bool) {
    if a {
        foo();
        if b {
            bar();
        }
    } else if c {
        baz();
    } else {
        qux();
    }
}

pub fn seq_mixed(a: bool, b: bool) {
    foo();
    if a {
        bar();
    }
    while b {
        baz();
    }
}
