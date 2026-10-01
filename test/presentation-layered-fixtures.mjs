import { writePsd } from "../src/presentation/node_modules/ag-psd/dist/index.js";
import { writeZip } from "../src/presentation/package.js";
import { utf8 } from "../src/presentation/data.js";
import { pngRGBA } from "./presentation-fixtures.mjs";
const bitmap = (w, h, color) => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(
    Array.from({ length: w * h }, () => color).flat(),
  ),
});
export function sourceFixtures() {
  const red = bitmap(2, 2, [255, 0, 0, 255]),
    blue = bitmap(2, 2, [0, 0, 255, 255]),
    poster = bitmap(6, 8, [30, 40, 50, 255]),
    png = pngRGBA(2, 2, red.data),
    merged = pngRGBA(6, 8, poster.data);
  const psd = new Uint8Array(
    writePsd(
      {
        width: 6,
        height: 8,
        imageData: poster,
        children: [
          { name: "Top petal", left: 3, top: 4, opacity: 0.5, imageData: red },
          { name: "Background", left: 0, top: 0, imageData: blue },
        ],
      },
      { generateThumbnail: false },
    ),
  );
  const ora = writeZip(
    new Map([
      ["mimetype", utf8("image/openraster")],
      [
        "stack.xml",
        utf8(
          '<image w="6" h="8" name="Flower field" version="0.0.6"><stack><layer name="Top petal" src="data/top.png" x="3" y="4" opacity="0.5"/><layer name="Background" src="data/back.png"/></stack></image>',
        ),
      ],
      ["data/top.png", png],
      ["data/back.png", png],
      ["mergedimage.png", merged],
    ]),
  );
  const zip = writeZip(
    new Map([
      [
        "layers.json",
        utf8(
          JSON.stringify({
            version: 1,
            order: "bottom-to-top",
            width: 6,
            height: 8,
            title: "AI scene",
            preview: "preview.png",
            layers: [
              { name: "Background", file: "back.png", x: 0, y: 0 },
              {
                name: "Petal",
                file: "petal.png",
                x: 3,
                y: 4,
                parallax: [1, 2],
                material: { kind: "glitter", size: 2 },
                bindings: { "material.angle": ["input", "angle"] },
              },
            ],
          }),
        ),
      ],
      ["back.png", png],
      ["petal.png", png],
      ["preview.png", merged],
    ]),
  );
  return { psd, ora, zip };
}
