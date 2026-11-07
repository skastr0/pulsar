export const make = (n: number) => {
  const inner = () => n || 0;
  return [1, 2].map((v) => v + inner());
};

class Box {
  value = () => 1;
  static { init(); }
  constructor() {}
  get size() { return 1; }
  set size(v: number) {}
  run() {
    const go = function named() {};
    return go;
  }
}

export default function () {}
const o = { m() {}, k: memo(() => 1) };
