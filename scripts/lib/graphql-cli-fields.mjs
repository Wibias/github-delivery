export function graphqlCliField(value, label) {
  const text = String(value ?? "");
  if (text.startsWith("@")) throw new Error(`${label}_at_file`);
  return text;
}
