function g(xs: number[], k: string) {
  for (const x of xs) {
    if (x < 0) continue;
    while (x > 10 && k) {
      break;
    }
  }
  try {
    risky();
  } catch (e) {
    throw e;
  } finally {
    done();
  }
  switch (k) {
    case "a":
      return 1;
    case "b":
    case "c":
      break;
    default:
      return 3;
  }
}
