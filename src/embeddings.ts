export function float32ArrayToBuffer(vector: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < vector.length; i += 1) {
    buffer.writeFloatLE(vector[i] ?? 0, i * Float32Array.BYTES_PER_ELEMENT);
  }
  return buffer;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
