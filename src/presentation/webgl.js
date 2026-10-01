import { ensure } from "./data.js";
const vertex = `#version 300 es
in vec2 position; in vec2 uv; in vec2 local;
uniform vec2 resolution;
out vec2 tex; out vec2 point;
void main(){gl_Position=vec4(position.x/resolution.x*2.-1.,1.-position.y/resolution.y*2.,0.,1.);tex=uv;point=local;}`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D art; uniform sampler2D maskArt; uniform sampler2D flakeArt; uniform sampler2D effectMaskArt;
uniform float opacity; uniform float brightness; uniform float saturation;
uniform vec4 fillColor; uniform int hasFill;
uniform int effect; uniform vec4 params; uniform vec4 details;
uniform vec2 center; uniform vec2 nodeSize; uniform vec4 clip; uniform vec2 resolution;
uniform int maskMode; uniform int polygonCount; uniform vec2 polygon[64]; uniform int hasMask; uniform int hasFlake;
uniform int flakeColor; uniform int hasEffectMask; uniform int surface; uniform int flakeShape; uniform vec3 tint; uniform int hasTint;
in vec2 tex; in vec2 point; out vec4 color;
float hash(vec2 p){uvec2 q=uvec2(ivec2(floor(p)));uint n=q.x*1597334677u+q.y*3812015801u;n=(n^(n>>16u))*2246822519u;n=(n^(n>>13u))*3266489917u;return float((n^(n>>16u))&16777215u)/16777216.;}
void main(){
 vec2 screen=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);
 vec2 q=abs(screen-(clip.xy+clip.zw*.5))-(clip.zw*.5-vec2(9.));
 float edge=1.-smoothstep(8.,9.,length(max(q,0.)));
 vec4 c=hasFill==1?fillColor:texture(art,tex); c.rgb=mix(vec3(dot(c.rgb,vec3(.2126,.7152,.0722))),c.rgb,saturation)*brightness;
 if(polygonCount>0){bool inside=false;int j=polygonCount-1;for(int i=0;i<64;i++){if(i>=polygonCount)break;vec2 a=polygon[i],b=polygon[j];if(((a.y>point.y)!=(b.y>point.y))&&(point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x))inside=!inside;j=i;}c.a*=maskMode==1?(inside?0.:1.):(inside?1.:0.);}
 if(hasMask==1){float coverage=texture(maskArt,point).a;c.a*=maskMode==1?1.-coverage:coverage;}
 float weight=hasEffectMask==1?texture(effectMaskArt,point).a:1.;
 if(effect==1){float d=length((point-center)*vec2(1.,nodeSize.y/nodeSize.x));float radius=params.x*1.3;c.a*=1.-smoothstep(max(0.,radius-details.x),radius+.001,d);}
 if(effect==2){vec2 direction=vec2(.927,.375);float line=dot(point*nodeSize,direction)/dot(nodeSize,direction);float distance=abs(line-params.x)/max(.01,details.x);float band=max(0.,1.-distance)*weight;float ripple=.65+.35*sin(point.y*420.+sin(point.x*29.)*2.);if(surface==1)c.rgb+=vec3(.7,.85,1.)*band*ripple*params.z;else{c.a*=band;c.rgb*=1.+ripple*params.z;}}
 if(effect==3){vec2 grid=point*nodeSize/max(.5,details.x);vec2 cell=floor(grid);float r=hash(cell+details.z);vec2 f=(fract(grid)-.5)/max(.1,1.-details.w*hash(cell+13.));float catchLight=pow(max(0.,cos(params.y*6.283185+hash(cell+7.)*6.283185)),mix(64.,3.,clamp(params.w,0.,1.)));float d=length(f);if(flakeShape==1)d=max(abs(f.y),dot(abs(f),vec2(.866,.5)));if(flakeShape==2)d=max(abs(f.x)*1.7,abs(f.y)*.8);if(flakeShape==3)d=length(f)/(.7+.3*cos(atan(f.y,f.x)*5.));float facet=step(r,details.y)*(1.-smoothstep(.3,.43,d));if(hasFlake==1)facet=step(r,details.y)*texture(flakeArt,fract(grid)).a;vec3 holo=hasTint==1?tint:.55+.45*cos(vec3(0.,2.,4.)+r*5.+params.y*5.);if(hasFlake==1&&flakeColor==1)holo=texture(flakeArt,fract(grid)).rgb;c.rgb+=mix(holo,vec3(1.),catchLight*.6)*facet*catchLight*params.z*weight;}
 if(effect==4){float d=length((point-center)*vec2(1.,nodeSize.y/nodeSize.x));float spot=(1.-smoothstep(0.,max(.001,details.x),d))*weight;if(surface==1)c.rgb+=c.rgb*spot*params.z;else{c.a*=spot;c.rgb*=1.+params.z;}}
 if(effect==5){float band=pow(max(0.,1.-abs(point.x+point.y*.4-params.y)/max(.01,details.x)),2.);c.rgb+=(.5+.5*cos(vec3(0.,2.,4.)+point.y*6.+params.y*5.))*band*params.z*weight;}
 c.a*=opacity*edge;color=vec4(c.rgb*c.a,c.a);
}`;
export function createWebGLRenderer(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  ensure(gl, "WEBGL", "WebGL2 unavailable");
  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    ensure(
      gl.getShaderParameter(s, gl.COMPILE_STATUS),
      "SHADER",
      gl.getShaderInfoLog(s),
    );
    return s;
  }
  const program = gl.createProgram(),
    vs = shader(gl.VERTEX_SHADER, vertex),
    fs = shader(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  ensure(
    gl.getProgramParameter(program, gl.LINK_STATUS),
    "SHADER",
    gl.getProgramInfoLog(program),
  );
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const buffer = gl.createBuffer(),
    vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [i, name] of ["position", "uv", "local"].entries()) {
    const at = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 24, i * 8);
  }
  const names = [
    "fillColor",
    "hasFill",
    "resolution",
    "opacity",
    "brightness",
    "saturation",
    "effect",
    "params",
    "details",
    "center",
    "nodeSize",
    "clip",
    "art",
    "maskArt",
    "flakeArt",
    "effectMaskArt",
    "maskMode",
    "polygonCount",
    "polygon[0]",
    "hasMask",
    "hasFlake",
    "hasEffectMask",
    "surface",
    "flakeShape",
    "flakeColor",
    "tint",
    "hasTint",
  ];
  const u = Object.fromEntries(
    names.map((n) => [n, gl.getUniformLocation(program, n)]),
  );
  const textures = new Set();
  let draws = 0;
  function texture(source) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.add(t);
    return t;
  }
  const whiteCanvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(1, 1)
      : Object.assign(document.createElement("canvas"), {
          width: 1,
          height: 1,
        });
  const c = whiteCanvas.getContext("2d");
  c.fillStyle = "white";
  c.fillRect(0, 0, 1, 1);
  const white = texture(whiteCanvas);
  return {
    gl,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxSurfaceDimension: Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      ...gl.getParameter(gl.MAX_VIEWPORT_DIMS),
    ),
    texture,
    updateTexture(t, source) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
    },
    release(t) {
      if (t && t !== white && textures.delete(t)) gl.deleteTexture(t);
    },
    begin(width, height) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      gl.uniform2f(u.resolution, width, height);
      gl.uniform1i(u.art, 0);
      gl.uniform1i(u.maskArt, 1);
      gl.uniform1i(u.flakeArt, 2);
      gl.uniform1i(u.effectMaskArt, 3);
      draws = 0;
    },
    draw(node, asset, matrix, viewport, mask, flake, effectMask) {
      const w = node.width,
        h = node.height,
        px = node.pivotX ?? w / 2,
        py = node.pivotY ?? h / 2,
        r = ((node.rotation ?? 0) * Math.PI) / 180,
        cos = Math.cos(r),
        sin = Math.sin(r),
        sx = node.scaleX ?? 1,
        sy = node.scaleY ?? 1;
      const localCorners = [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 1],
          [1, 0],
          [1, 1],
        ],
        out = [];
      const rect = node.rect ?? [0, 0, asset.width, asset.height];
      for (const [a, b] of localCorners) {
        const dx = (a * w - px) * sx,
          dy = (b * h - py) * sy;
        const x = (node.x ?? 0) + px + dx * cos - dy * sin,
          y = (node.y ?? 0) + py + dx * sin + dy * cos;
        out.push(
          matrix[0] * x + matrix[2] * y + matrix[4],
          matrix[1] * x + matrix[3] * y + matrix[5],
          (rect[0] + a * rect[2]) / asset.width,
          (rect[1] + b * rect[3]) / asset.height,
          a,
          b,
        );
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.DYNAMIC_DRAW);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, asset.texture);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        node.sampling === "nearest" ? gl.NEAREST : gl.LINEAR,
      );
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MAG_FILTER,
        node.sampling === "nearest" ? gl.NEAREST : gl.LINEAR,
      );
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mask?.texture ?? white);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, flake?.texture ?? white);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, effectMask?.texture ?? white);
      gl.uniform1i(u.hasFill, node._fill ? 1 : 0);
      gl.uniform4fv(
        u.fillColor,
        node._fill
          ? [1, 3, 5, 7].map((i) =>
              i === 7 && node._fill.length === 7
                ? 1
                : parseInt(node._fill.slice(i, i + 2), 16) / 255,
            )
          : [0, 0, 0, 0],
      );
      gl.uniform1f(u.opacity, node.opacity ?? 1);
      gl.uniform1f(u.brightness, node.brightness ?? 1);
      gl.uniform1f(u.saturation, node.saturation ?? 1);
      gl.uniform2f(u.nodeSize, w, h);
      gl.uniform4fv(u.clip, viewport);
      const material = node.material ?? {},
        kind =
          { bloom: 1, water: 2, glitter: 3, spot: 4, foil: 5 }[material.kind] ??
          0;
      gl.uniform1i(u.effect, kind);
      gl.uniform4f(
        u.params,
        material.sweep ?? material.progress ?? 1,
        material.angle ?? 0,
        material.intensity ?? 1,
        material.roughness ?? 0.3,
      );
      gl.uniform4f(
        u.details,
        material.size ?? material.radius ?? material.feather ?? 0.18,
        material.density ?? 0.25,
        material.seed ?? 1,
        material.variation ?? 0.3,
      );
      gl.uniform2fv(u.center, material.center ?? [0.5, 0.5]);
      gl.uniform1i(u.hasEffectMask, effectMask ? 1 : 0);
      gl.uniform1i(u.surface, material.mode === "surface" ? 1 : 0);
      gl.uniform1i(
        u.flakeShape,
        { circle: 0, hexagon: 1, shard: 2, star: 3 }[material.shape] ?? 0,
      );
      gl.uniform1i(u.hasTint, material.color ? 1 : 0);
      gl.uniform3fv(
        u.tint,
        material.color
          ? [1, 3, 5].map(
              (i) => parseInt(material.color.slice(i, i + 2), 16) / 255,
            )
          : [1, 1, 1],
      );
      gl.uniform1i(u.hasMask, mask ? 1 : 0);
      gl.uniform1i(u.flakeColor, material.flakeColor === "texture" ? 1 : 0);
      gl.uniform1i(u.hasFlake, flake ? 1 : 0);
      const polygon = node.mask?.polygon ?? [];
      gl.uniform1i(u.polygonCount, polygon.length);
      gl.uniform1i(u.maskMode, node.mask?.invert ? 1 : 0);
      if (polygon.length)
        gl.uniform2fv(u["polygon[0]"], new Float32Array(polygon.flat()));
      if (node.blend === "add") gl.blendFunc(gl.ONE, gl.ONE);
      else if (node.blend === "screen")
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      else if (node.blend === "multiply")
        gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      draws++;
    },
    background(color, matrix, viewport, width, height) {
      if (color && color !== "transparent")
        this.draw(
          { _fill: color, width, height },
          { texture: white, width: 1, height: 1 },
          matrix,
          viewport,
        );
    },
    diagnostics() {
      return { draws, textures: textures.size - (textures.has(white) ? 1 : 0) };
    },
    dispose() {
      for (const t of textures) gl.deleteTexture(t);
      textures.clear();
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
