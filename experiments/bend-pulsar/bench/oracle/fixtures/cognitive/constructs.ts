// ---- c.ts
export function f_if(a: number) { if (a) { return 1; } return 0; }
export function f_if_else(a: number) { if (a) { return 1; } else { return 2; } }
export function f_if_elseif(a: number) { if (a === 1) { return 1; } else if (a === 2) { return 2; } return 0; }
export function f_if_elseif_else(a: number) { if (a === 1) { return 1; } else if (a === 2) { return 2; } else { return 3; } }
export function f_nested_if(a: number, b: number) { if (a) { if (b) { return 1; } } return 0; }
export function f_nested_if3(a: number, b: number, c: number) { if (a) { if (b) { if (c) { return 1; } } } return 0; }
export function f_ternary(a: number) { return a ? 1 : 2; }
export function f_nested_ternary(a: number, b: number) { return a ? (b ? 1 : 2) : 3; }
export function f_ternary_in_if(a: number, b: number) { if (a) { return b ? 1 : 2; } return 0; }
export function f_switch(a: number) { switch (a) { case 1: return 1; case 2: return 2; default: return 3; } }
export function f_switch_nested(a: number, b: number) { switch (a) { case 1: if (b) { return 1; } return 2; default: return 3; } }
export function f_for(xs: number[]) { for (let i = 0; i < xs.length; i++) { xs[i]++; } }
export function f_forof(xs: number[]) { for (const x of xs) { void x; } }
export function f_forin(o: object) { for (const k in o) { void k; } }
export function f_while(a: number) { while (a > 0) { a--; } }
export function f_dowhile(a: number) { do { a--; } while (a > 0); }
export function f_loop_if(xs: number[]) { for (const x of xs) { if (x) { continue; } } }
export function f_if_loop(a: number, xs: number[]) { if (a) { for (const x of xs) { void x; } } }
export function f_and(a: boolean, b: boolean) { return a && b; }
export function f_and_and(a: boolean, b: boolean, c: boolean) { return a && b && c; }
export function f_and_or(a: boolean, b: boolean, c: boolean) { return a && b || c; }
export function f_or_and_or(a: boolean, b: boolean, c: boolean, d: boolean) { return a || b && c || d; }
export function f_if_and(a: boolean, b: boolean) { if (a && b) { return 1; } return 0; }
export function f_if_and_or(a: boolean, b: boolean, c: boolean) { if (a && b || c) { return 1; } return 0; }
export function f_nullish(a?: number) { return a ?? 1; }
export function f_nullish_and(a?: number, b?: boolean) { return (a ?? 1) && b; }
export function f_optchain(a?: { b?: number }) { return a?.b; }
export function f_optchain2(a?: { b?: { c?: number } }) { return a?.b?.c; }
export function f_default(a = 1) { return a; }
export function f_destruct_default({ a = 1 }: { a?: number }) { return a; }
export function f_try(a: () => void) { try { a(); } catch (e) { void e; } }
export function f_try_finally(a: () => void) { try { a(); } finally { void 0; } }
export function f_try_in_if(a: () => void, b: boolean) { if (b) { try { a(); } catch (e) { void e; } } }
export function f_catch_if(a: () => void, b: boolean) { try { a(); } catch (e) { if (b) { void e; } } }
export function f_label(xs: number[][]) { outer: for (const a of xs) { for (const b of a) { if (b) { continue outer; } } } }
export function f_break_label(xs: number[][]) { outer: for (const a of xs) { for (const b of a) { if (b) { break outer; } } } }
export function f_recursion(n: number): number { if (n <= 0) { return 0; } return f_recursion(n - 1); }
export function f_callback(xs: number[]) { return xs.map((x) => x + 1); }
export function f_callback_if(xs: number[]) { return xs.map((x) => { if (x) { return 1; } return 0; }); }
export function f_if_callback_if(a: boolean, xs: number[]) { if (a) { return xs.map((x) => { if (x) { return 1; } return 0; }); } return []; }
export function f_callback_and(xs: number[]) { return xs.filter((x) => x && x > 1); }
export function f_nested_decl(a: boolean) { function inner(b: boolean) { if (b) { return 1; } return 0; } if (a) { return inner(a); } return 0; }
export const f_arrow_if = (a: boolean) => { if (a) { return 1; } return 0; };
export function f_and_assign(a: { v?: number }) { a.v ||= 1; a.v &&= 2; a.v ??= 3; }
export function f_return_ternary_and(a: boolean, b: boolean) { return a && b ? 1 : 2; }
export function f_throw_if(a: boolean) { if (a) { throw new Error("x"); } }
export function f_await_if(a: Promise<boolean>) { return a.then(() => 1); }
export async function f_async_if(a: Promise<boolean>) { if (await a) { return 1; } return 0; }
export function f_else_if_chain4(a: number) { if (a === 1) { return 1; } else if (a === 2) { return 2; } else if (a === 3) { return 3; } else if (a === 4) { return 4; } return 0; }
export function f_if_else_nested(a: boolean, b: boolean) { if (a) { if (b) { return 1; } else { return 2; } } else { return 3; } }
export function f_loop_and(xs: number[], a: boolean) { for (const x of xs) { if (a && x) { return x; } } }
export function f_while_and(a: boolean, b: boolean) { while (a && b) { a = false; } }
export function f_class_method_holder() { class K { m(a: boolean) { if (a) { return 1; } return 0; } } return K; }
export function f_not_cond(a: boolean, b: boolean) { if (!(a && b)) { return 1; } return 0; }
export function f_template_ternary(a: boolean) { return `${a ? "x" : "y"}`; }
export function f_arg_ternary(a: boolean) { return Math.max(a ? 1 : 2, 3); }
// ---- d.ts
export function g_cb_outer(xs: number[]) {
  return xs.map((x) => {
    if (x) {
      return 1;
    }
    return 0;
  });
}
export function g_if_cb(a: boolean, xs: number[]) {
  if (a) {
    return xs.map((x) => {
      if (x) {
        return 1;
      }
      return 0;
    });
  }
  return [];
}
export function g_cb_cb(xs: number[][]) {
  return xs.map((a) => {
    return a.map((b) => {
      if (b) {
        return 1;
      }
      return 0;
    });
  });
}
export function g_iife(a: boolean) {
  return (() => {
    if (a) {
      return 1;
    }
    return 0;
  })();
}
export function g_obj_method(a: boolean) {
  return {
    m() {
      if (a) {
        return 1;
      }
      return 0;
    },
  };
}
export function g_ternary_chain(a: number) {
  return a === 1 ? "x" : a === 2 ? "y" : "z";
}
export function g_nullish_chain(a?: number, b?: number, c?: number) {
  return a ?? b ?? c;
}
export function g_or_nullish(a?: number, b?: number, c?: number) {
  return (a || b) ?? c;
}
export function g_not_or(a: boolean, b: boolean) {
  return !a || b;
}
export function g_cond_ternary(a: boolean, b: boolean) {
  return a && b ? 1 : 2;
}
export function g_and_or_and(a: boolean, b: boolean, c: boolean, d: boolean) {
  return a && b || c && d;
}
export function g_or_and(a: boolean, b: boolean, c: boolean) {
  return a || b && c;
}
export function g_paren_mix(a: boolean, b: boolean, c: boolean) {
  return a && (b || c);
}
export function g_if_else_if_nested(a: number, b: boolean) {
  if (a === 1) {
    if (b) {
      return 1;
    }
  } else if (a === 2) {
    return 2;
  }
  return 0;
}
export function g_else_in_loop(xs: number[]) {
  for (const x of xs) {
    if (x) {
      continue;
    } else {
      break;
    }
  }
}
export function g_else_only_return(a: boolean) {
  if (a) {
    return 1;
  } else {
    return 2;
  }
}
export function g_switch_in_if(a: boolean, b: number) {
  if (a) {
    switch (b) {
      case 1:
        return 1;
      default:
        return 2;
    }
  }
  return 0;
}
export function g_catch_else(a: () => void, b: boolean) {
  try {
    a();
  } catch (e) {
    if (b) {
      void e;
    } else {
      void 0;
    }
  }
}
export function g_while_else(a: number) {
  while (a > 0) {
    if (a === 3) {
      a -= 2;
    } else {
      a--;
    }
  }
}
export function g_async_arrow_cb(a: boolean) {
  return Promise.resolve(1).then(async () => {
    if (a) {
      await Promise.resolve();
    }
  });
}
export function g_recursion_in_cb(n: number): number[] {
  return [n].flatMap((x) => (x > 0 ? g_recursion_in_cb(x - 1) : []));
}
export function g_label_plain(xs: number[]) {
  loop: for (const x of xs) {
    if (x) {
      break loop;
    }
  }
}
export function g_break_plain(xs: number[]) {
  for (const x of xs) {
    if (x) {
      break;
    }
  }
}
export function g_default_in_cb(xs: number[]) {
  return xs.map((x = 1) => x);
}
export function g_spread_ternary(a: boolean, xs: number[]) {
  return [...(a ? xs : [])];
}
export function g_optional_call(a?: () => number) {
  return a?.() ?? 0;
}
export function g_instance_getter() {
  return class {
    get v() {
      return 1;
    }
  };
}
// ---- e.ts
export function o_or_return(a: any, b: any, c: any, d: any) {
  return a || b;
}
export function o_or_assign(a: any, b: any, c: any, d: any) {
  const x = a || b;
  return x;
}
export function o_or_if(a: any, b: any, c: any, d: any) {
  if (a || b) {
    return 1;
  }
  return 0;
}
export function o_or_or_if(a: any, b: any, c: any, d: any) {
  if (a || b || c) {
    return 1;
  }
  return 0;
}
export function o_or_arg(a: any, b: any, c: any, d: any) {
  return Boolean(a || b);
}
export function o_or_ternary(a: any, b: any, c: any, d: any) {
  return a || b ? 1 : 2;
}
export function o_and_return(a: any, b: any, c: any, d: any) {
  return a && b;
}
export function o_and_assign(a: any, b: any, c: any, d: any) {
  const x = a && b;
  return x;
}
export function o_and_if(a: any, b: any, c: any, d: any) {
  if (a && b) {
    return 1;
  }
  return 0;
}
export function o_and_then_or_if(a: any, b: any, c: any, d: any) {
  if (a && b || c) {
    return 1;
  }
  return 0;
}
export function o_or_then_and_if(a: any, b: any, c: any, d: any) {
  if (a || b && c) {
    return 1;
  }
  return 0;
}
export function o_or_and_or_if(a: any, b: any, c: any, d: any) {
  if (a || b && c || d) {
    return 1;
  }
  return 0;
}
export function o_and_or_and_if(a: any, b: any, c: any, d: any) {
  if (a && b || c && d) {
    return 1;
  }
  return 0;
}
export function o_and_paren_or_if(a: any, b: any, c: any, d: any) {
  if (a && (b || c)) {
    return 1;
  }
  return 0;
}
export function o_not_or_if(a: any, b: any, c: any, d: any) {
  if (!a || b) {
    return 1;
  }
  return 0;
}
export function o_or_cmp_if(a: any, b: any, c: any, d: any) {
  if (a === 1 || b === 2) {
    return 1;
  }
  return 0;
}
export function o_or_call_if(a: any, b: any, c: any, d: any) {
  if (a() || b()) {
    return 1;
  }
  return 0;
}
// ---- g.ts
export function p_and_two_stmts(a: any, b: any, c: any, d: any, f: any) {
  const x = a && b;
  const y = c && d;
  return [x, y];
}
export function p_and_two_stmts_sep(a: any, b: any, c: any, d: any, f: any) {
  const x = a && b;
  void 0;
  const y = c && d;
  return [x, y];
}
export function p_and_same_expr(a: any, b: any, c: any, d: any, f: any) {
  return [a && b, c && d];
}
export function p_and_in_calls(a: any, b: any, c: any, d: any, f: any) {
  f(a && b);
  f(c && d);
}
export function p_and_after_if(a: any, b: any, c: any, d: any, f: any) {
  if (a) {
    f();
  }
  return b && c;
}
export function p_tern_alt(a: any, b: any, c: any, d: any, f: any) {
  return a ? 1 : b ? 2 : 3;
}
export function p_tern_cons(a: any, b: any, c: any, d: any, f: any) {
  return a ? (b ? 1 : 2) : 3;
}
export function p_tern_alt3(a: any, b: any, c: any, d: any, f: any) {
  return a ? 1 : b ? 2 : c ? 3 : 4;
}
export function p_if_tern_alt(a: any, b: any, c: any, d: any, f: any) {
  if (a) {
    return b ? 1 : c ? 2 : 3;
  }
  return 0;
}
export function p_two_tern(a: any, b: any, c: any, d: any, f: any) {
  const x = a ? 1 : 2;
  const y = b ? 3 : 4;
  return [x, y];
}
export function p_and_seq_tern(a: any, b: any, c: any, d: any, f: any) {
  return a && b ? 1 : 2;
}
export function p_recursion_method(a: any, b: any, c: any, d: any, f: any) {
  return this.p_recursion_method(a);
}
export function p_nullish_two(a: any, b: any, c: any, d: any, f: any) {
  const x = a ?? b;
  const y = c ?? d;
  return [x, y];
}
export function p_or_two_stmts(a: any, b: any, c: any, d: any, f: any) {
  const x = a || b;
  const y = c || d;
  return [x, y];
}
// ---- h.ts
export function r1_and3(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return a && b && c;
}
export function r2_and_or_and(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return a && (b || c) && d;
}
export function r3_or_paren_and3_and(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return (a || (b && c && d)) && f;
}
export function r4_paren_both(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return (a && b) || (c && d);
}
export function r5_mixed5(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return a && b || c && d && e;
}
export function r6_paper(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return (a && b && c) || d || e && f;
}
export function r7_two_trees(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return [a && b, c && d];
}
export function r8_nested_arg(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return a && g(b && c);
}
export function r9_or_between(a: any, b: any, c: any, d: any, e: any, f: any, g: any) {
  return a && b || c && d || e && f;
}
