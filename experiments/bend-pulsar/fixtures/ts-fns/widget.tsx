export function Widget({ items }: { items: string[] }) {
  return <ul>{items.map((s) => <li key={s}>{s}</li>)}</ul>;
}
