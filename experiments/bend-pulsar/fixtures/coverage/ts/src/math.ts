export function add(a: number, b: number): number {
  return a + b;
}

export function classify(n: number): string {
  if (n > 0) {
    return "positive";
  }
  if (n < 0) {
    return "negative";
  }
  return "zero";
}

export function unreached(): number {
  return 42;
}
