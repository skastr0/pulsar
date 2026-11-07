// NPath fixtures — expected values are hand-computed from the Nejmeh 1988
// recurrences (NPATH is NOT the acyclic path count; see research/thresholds.md
// and bench/oracle/ORACLE.md). Formulas used, per the ACPATH paper's
// restatement of Nejmeh88:
//   NP_E(name|literal) = 0;  NP_E(E1 && E2) = NP_E(E1)+NP_E(E2)+1;
//   NP_E(E1 || E2) = NP_E(E1)+NP_E(E2)+1;  NP_E(E1 bop E2) = sum;
//   NP_E(E1?E2:E3) = NP_E(E1)+NP_E(E2)+NP_E(E3)+2
//   NP_S(E;) = NP_E(E);  NP_S(S1 S2) = product;  NP_S(return E) = max(1,NP_E(E));
//   NP_S(if E S1 else S2) = NP_E(E)+NP_S(S1)+NP_S(S2);
//   NP_S(if E S1) = NP_E(E)+NP_S(S1)+1;
//   NP_S(switch E {k arms + default}) = NP_E(E) + sum(arms) + default;
//   NP_S(while E S) = NP_E(E)+NP_S(S)+1;  NP_S(for E1;E2;E3 S) = sum+NP_S(S)+1;
//   NP_S(stm) = 1;  NP_S(break|continue|goto) = 1;  NP_S({S}) = NP_S(S)
// Avoided on purpose: || (formula cell unreadable in the paper's table
// extraction), do-while, continue, labels — revisit if the engine proves
// different recurrences for them.

function foo() {}
function bar() {}
function baz() {}
function qux() {}

export function straight(x: number): number {
  return x + 1;
}

export function one_if(c: boolean): void {
  if (c) foo();
}

export function if_else(c: boolean): void {
  if (c) foo();
  else bar();
}

export function two_ifs(c: boolean, d: boolean): void {
  if (c) foo();
  if (d) bar();
}

export function nested_if(c: boolean, d: boolean): void {
  if (c) {
    if (d) foo();
  } else bar();
}

export function and_pred(a: boolean, b: boolean): void {
  if (a && b) foo();
}

export function while_and(a: boolean, b: boolean): void {
  while (a && b) foo();
}

export function switch3(x: number): void {
  switch (x) {
    case 1:
      foo();
      break;
    case 2:
      bar();
      break;
    default:
      baz();
  }
}

export function ternary_ret(c: boolean): number {
  return c ? 1 : 2;
}

export function while_loop(c: boolean): void {
  while (c) foo();
}

export function for_loop(): void {
  for (let i = 0; i < 10; i++) foo();
}

export function guard_return(c: boolean): void {
  if (!c) return;
  foo();
  bar();
}

export function deep_nest(a: boolean, b: boolean, c: boolean): void {
  if (a) {
    foo();
    if (b) bar();
  } else {
    if (c) baz();
    else qux();
  }
}

export function seq_mixed(a: boolean, b: boolean): void {
  foo();
  if (a) bar();
  while (b) baz();
}
