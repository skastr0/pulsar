# infra-escape fixtures

Fixtures for the rule that an env object which escapes cannot be claimed never-read (#725). Each
`.ts` file is one case and was written for this rule; none comes from a real repository.

Format. The first line is `// expect: reads=<A,B,...> escapes=<n>` (sorted, comma separated, the
literal-key reads the lane must find, and the number of escape sites). A trailing `conservative`
marks a case whose expected result is the sound, over-eager reading. Every line that must be
recorded as an escape site ends in `// ESC`; the number of such lines equals `escapes`.

- `escape-*.ts`: shapes that escape (non-literal index, call, new or tagged-template argument,
  spread, rest element, return, yield, assignment or declaration init, property value, array
  element, the value of `??`, `||` or a ternary).
- `keep-*.ts`: shapes that must not escape (literal member reads, `?.`, literal destructuring,
  a destructured parameter, `this.env`, the bare parameter, non-flowing tests, a closure read,
  a local object named `env`).

The Workers environment is, as in the lane, an `env` imported from `cloudflare:workers`, a
parameter named `env` or a destructured parameter, `this.env`, `ctx.env` and `alias.env`.
