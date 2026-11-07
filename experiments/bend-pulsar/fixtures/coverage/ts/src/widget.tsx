type Props = { label: string; items: string[] };

export const Widget = ({ label, items }: Props) => {
  return (
    <ul title={label}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
};

export function Empty({ label }: Props) {
  return <p>{label}</p>;
}
