export function outer(flag: boolean): number {
  const twice = (n: number) => {
    return n * 2;
  };
  if (flag) {
    return twice(1);
  }
  return 0;
}
