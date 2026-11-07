function h(o: any, n: number) {
  for (let i = 0; i < n; i++) {}
  for (const k in o) {}
  do { n--; } while (n > 0 || o);
  o.a ??= 1;
  o.b &&= 2;
  o.c ||= 3;
  return o.d ?? n;
}
