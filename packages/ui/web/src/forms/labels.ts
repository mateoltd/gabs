export function fieldLabel(key: string) {
  return key
    .replace(/[_-]/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());
}
