// Reserve 16% for controls on a normal portrait phone. Large text and short screens
// may need more space so Stop never becomes unreachable.
export function assistantLayout(height: number, bottomInset: number, fontScale: number) {
  const controls = Math.max(height * 0.16, 56 * Math.max(1, fontScale) + 16 + bottomInset);
  return { camera: Math.max(0, height - controls), controls };
}
