export function f(a: number, b: number) {
  if (a > 0) {
    return 1;
  } else if (b > 0) {
    return 2;
  }
  const x = a ? 1 : 2;
  return x;
}
