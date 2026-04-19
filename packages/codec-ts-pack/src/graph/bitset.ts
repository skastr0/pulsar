export class MutableBitSet {
  private readonly words: Uint32Array

  constructor(readonly size: number) {
    this.words = new Uint32Array(Math.ceil(size / 32))
  }

  set(index: number): void {
    const wordIndex = index >>> 5
    const bit = index & 31
    this.words[wordIndex] = (this.words[wordIndex] ?? 0) | (1 << bit)
  }

  has(index: number): boolean {
    const wordIndex = index >>> 5
    const bit = index & 31
    return (((this.words[wordIndex] ?? 0) >>> bit) & 1) === 1
  }

  or(other: MutableBitSet): boolean {
    let changed = false
    for (let index = 0; index < this.words.length; index += 1) {
      const next = (this.words[index] ?? 0) | (other.words[index] ?? 0)
      if (next !== this.words[index]) {
        this.words[index] = next
        changed = true
      }
    }
    return changed
  }

  count(): number {
    let total = 0
    for (const word of this.words) {
      total += popcount32(word)
    }
    return total
  }

  clone(): MutableBitSet {
    const clone = new MutableBitSet(this.size)
    clone.words.set(this.words)
    return clone
  }

  values(): ReadonlyArray<number> {
    const values: Array<number> = []
    for (let index = 0; index < this.size; index += 1) {
      if (this.has(index)) {
        values.push(index)
      }
    }
    return values
  }
}

const popcount32 = (word: number): number => {
  let value = word >>> 0
  value -= (value >>> 1) & 0x55555555
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}
