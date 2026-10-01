/** Host-installed mod. Add to createPlayerStage({ adapters: [starFieldAdapter()] }).
 * Card requests optional example.stars@0.1 with omit-decorative fallback.
 * No changes to the player or built-in material implementation.
 */
export function starFieldAdapter() {
  return {
    id: "example.stars",
    version: "0.1.0",
    apiVersion: "0.1.0",
    trust: "host-installed",
    capabilities: ["example.stars@0.1"],
    provides: ["example.stars"],
    fallback: "omit-decorative",
    estimate: ({ width, height }) => width * height * 8,
    async create({ width, height, signal }, data = {}) {
      signal.throwIfAborted();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const count = Math.max(1, Math.min(200, Number(data.count) || 24));
      let seed = (Number(data.seed) || 37) >>> 0,
        angle = 0,
        disposed = false;
      const random = () =>
        (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      const stars = Array.from({ length: count }, () => ({
        x: random() * width,
        y: random() * height,
        phase: random() * Math.PI * 2,
        radius: 3 + random() * 12,
      }));
      return {
        canvas,
        update({ inputs }) {
          angle = inputs.angle ?? 0;
          return false;
        },
        render() {
          if (disposed) return;
          ctx.clearRect(0, 0, width, height);
          for (const s of stars) {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.phase + angle);
            ctx.globalAlpha =
              0.15 + 0.85 * Math.max(0, Math.cos(s.phase + angle * 6.28)) ** 4;
            ctx.fillStyle = `hsl(${(s.phase * 60 + angle * 180) % 360} 90% 80%)`;
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
              const r = s.radius * (i % 2 ? 0.42 : 1),
                a = (i * Math.PI) / 5;
              ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            }
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        },
        dispose() {
          disposed = true;
          canvas.width = canvas.height = 0;
        },
      };
    },
  };
}

// A compile-time recipe can turn one layer into multiple portable material layers.
export const sparkleRecipes = {
  "example.star-glitter": (
    node,
    {
      size = 16,
      density = 0.3,
      shape = "star",
      flakeAsset,
      flakeColor = "holo",
    } = {},
  ) => ({
    ...node,
    material: {
      kind: "glitter",
      size,
      density,
      shape,
      intensity: 2.2,
      roughness: 0.2,
      seed: 31,
      ...(flakeAsset ? { flakeAsset, flakeColor } : {}),
    },
    bindings: { ...node.bindings, "material.angle": ["input", "angle"] },
  }),
};
