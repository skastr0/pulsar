pub mod branch;
pub mod closures;
pub mod impls;
pub mod loops;
pub mod match_expr;
pub mod skipped;
pub mod try_ops;

#[cfg(test)]
mod tests {
    use super::*;
    use impls::Reset;

    #[test]
    fn branch_arms() {
        assert_eq!(branch::grade(95), 'A');
        assert_eq!(branch::grade(50), 'C');
        assert_eq!(branch::describe(Some(1)), "some 1");
        assert_eq!(branch::describe(None), "none");
        assert_eq!(branch::nested(true, 5), 1);
        assert_eq!(branch::nested(false, 5), -1);
    }

    #[test]
    fn loops_terminate() {
        assert_eq!(loops::sum_to(3), 3);
        assert_eq!(loops::find_first_even(&[1, 2]), Some(2));
        assert_eq!(loops::find_first_even(&[1, 3]), None);
        assert_eq!(loops::first_over(&[1, 9], 5), Some(9));
        assert_eq!(loops::first_over(&[1, 2], 5), None);
    }

    #[test]
    fn matches_pick_arms() {
        assert!(match_expr::area(&match_expr::Shape::Circle(1.0)) > 3.0);
        assert_eq!(match_expr::area(&match_expr::Shape::Square(2.0)), 4.0);
        assert_eq!(match_expr::label(0), "zero");
        assert_eq!(match_expr::label(9), "many");
        assert_eq!(match_expr::guarded(-1), "negative");
        assert_eq!(match_expr::guarded(0), "zero");
    }

    #[test]
    fn try_ops_succeed_and_fail() {
        assert_eq!(try_ops::first_number("4,5"), Ok(4));
        assert!(try_ops::first_number("x").is_err());
        assert_eq!(try_ops::second_number("1,2"), Ok(2));
        assert_eq!(try_ops::checked_div(4, 2), Some(2));
        assert_eq!(try_ops::checked_div(4, 0), None);
    }

    #[test]
    fn closures_capture() {
        assert_eq!(closures::doubled(&[1, 2]), vec![2, 4]);
        assert_eq!(closures::adder(3)(4), 7);
        assert_eq!(closures::nested_closures(), 7);
    }

    #[test]
    fn impls_mutate() {
        let mut counter = impls::Counter::new();
        assert_eq!(counter.bump(2), 2);
        counter.reset();
        assert_eq!(counter.bump(1), 1);
        assert_eq!(impls::generic_first(&[5, 6]), Some(5));
    }

    #[test]
    fn macro_fixture_runs() {
        assert!(skipped::macro_hides_if(true));
    }
}
