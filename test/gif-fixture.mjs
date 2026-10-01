// Synthetic GIF89a, no artwork: clear-code before each index keeps 3-bit LZW codes.
export function gifFixture(disposal = 1) {
  const out = [
    ...Buffer.from("GIF89a"),
    2,
    0,
    1,
    0,
    0x81,
    0,
    0,
    0,
    0,
    0,
    255,
    0,
    0,
    0,
    255,
    0,
    0,
    0,
    255,
  ];
  for (const [i, pixels] of [
    [1, 0],
    [0, 2],
    [0, 0],
  ].entries()) {
    out.push(
      33,
      249,
      4,
      ((i === 1 ? disposal : 1) << 2) | 1,
      5,
      0,
      0,
      0,
      44,
      0,
      0,
      0,
      0,
      2,
      0,
      1,
      0,
      0,
      2,
    );
    const codes = [4, pixels[0], 4, pixels[1], 5];
    let bits = 0,
      value = 0;
    const data = [];
    for (const c of codes) {
      value |= c << bits;
      bits += 3;
      while (bits >= 8) {
        data.push(value & 255);
        value >>= 8;
        bits -= 8;
      }
    }
    if (bits) data.push(value & 255);
    out.push(data.length, ...data, 0);
  }
  return Uint8Array.from([...out, 59]);
}
