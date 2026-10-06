import { ensure } from "./data.js";
export function maskLayout(mask = {}, asset = {}, node = {}) {
  const t=mask.transform ?? {}, sx=t.scaleX ?? 1, sy=t.scaleY ?? 1,
    r=((t.rotation ?? 0)%360)*Math.PI/180, c=Math.cos(r), s=Math.sin(r),
    aspect=(node.width ?? 1)/(node.height ?? 1), a=c*sx,b=s*sx*aspect,d=c*sy,e=-s*sy/aspect,
    px=t.pivotX ?? 0.5,py=t.pivotY ?? 0.5,
    x=(t.x ?? 0)+px-a*px-e*py,y=(t.y ?? 0)+py-b*px-d*py,det=a*d-b*e,
    width=asset.width ?? 1,height=asset.height ?? 1,rect=mask.rect ?? [0,0,width,height],
    uv=[rect[0]/width,rect[1]/height,rect[2]/width,rect[3]/height],
    halfX=asset.width?Math.min(uv[2]/2,0.5/(asset.textureWidth ?? width)):0,
    halfY=asset.height?Math.min(uv[3]/2,0.5/(asset.textureHeight ?? height)):0;
  return {
    matrix:new Float32Array([d/det,-b/det,0,-e/det,a/det,0,(e*y-d*x)/det,(b*x-a*y)/det,1]),
    rect:new Float32Array(uv),limits:new Float32Array([uv[0]+halfX,uv[1]+halfY,uv[0]+uv[2]-halfX,uv[1]+uv[3]-halfY]),
  };
}
const vertex = `#version 300 es
in vec2 position; in vec2 uv; in vec2 local;
uniform vec2 resolution;
out vec2 tex; out vec2 point;
void main(){gl_Position=vec4(position.x/resolution.x*2.-1.,1.-position.y/resolution.y*2.,0.,1.);tex=uv;point=local;}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D art; uniform sampler2D maskArt; uniform sampler2D flakeArt; uniform sampler2D effectMaskArt;
uniform float opacity; uniform float brightness; uniform float saturation;
uniform vec4 fillColor; uniform int hasFill;
uniform int effect; uniform vec4 params; uniform vec4 details;
uniform vec2 center; uniform vec2 nodeSize; uniform vec4 clip; uniform vec2 resolution;
uniform int maskMode; uniform int polygonCount; uniform vec2 polygon[64]; uniform int hasMask; uniform int hasFlake;
uniform mat3 maskMatrix; uniform vec4 maskRect; uniform vec4 maskLimits;
uniform mat3 effectMaskMatrix; uniform vec4 effectMaskRect; uniform vec4 effectMaskLimits;
uniform int effectPolygonCount; uniform vec2 effectPolygon[64]; uniform int effectMaskMode; uniform int effectMaskLayout;
uniform int flakeColor; uniform int hasEffectMask; uniform int surface; uniform int flakeShape; uniform vec3 tint; uniform int hasTint;
in vec2 tex; in vec2 point; out vec4 color;
float hash(vec2 p){uvec2 q=uvec2(ivec2(floor(p)));uint n=q.x*1597334677u+q.y*3812015801u;n=(n^(n>>16u))*2246822519u;n=(n^(n>>13u))*3266489917u;return float((n^(n>>16u))&16777215u)/16777216.;}
float polygonCoverage(vec2 p,int count,vec2 points[64]){bool inside=false;int j=count-1;for(int i=0;i<64;i++){if(i>=count)break;vec2 a=points[i],b=points[j];if(((a.y>p.y)!=(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))inside=!inside;j=i;}return inside?1.:0.;}
bool withinMask(vec2 p){return all(greaterThanEqual(p,vec2(0.)))&&all(lessThanEqual(p,vec2(1.)));}
void main(){
 vec2 screen=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);
 vec2 q=abs(screen-(clip.xy+clip.zw*.5))-(clip.zw*.5-vec2(9.));
 float edge=1.-smoothstep(8.,9.,length(max(q,0.)));
 vec4 c=hasFill==1?fillColor:texture(art,tex); c.rgb=mix(vec3(dot(c.rgb,vec3(.2126,.7152,.0722))),c.rgb,saturation)*brightness;
 vec2 maskPoint=(maskMatrix*vec3(point,1.)).xy;
 if(polygonCount>0||hasMask==1){float coverage=polygonCount>0?polygonCoverage(maskPoint,polygonCount,polygon):1.;if(hasMask==1)coverage*=withinMask(maskPoint)?texture(maskArt,clamp(maskRect.xy+maskPoint*maskRect.zw,maskLimits.xy,maskLimits.zw)).a:0.;c.a*=maskMode==1?1.-coverage:coverage;}
 vec2 effectPoint=(effectMaskMatrix*vec3(point,1.)).xy;
 float weight=effectPolygonCount>0?polygonCoverage(effectPoint,effectPolygonCount,effectPolygon):1.;if(hasEffectMask==1)weight*=withinMask(effectPoint)?texture(effectMaskArt,clamp(effectMaskRect.xy+effectPoint*effectMaskRect.zw,effectMaskLimits.xy,effectMaskLimits.zw)).a:0.;if(effectMaskMode==1)weight=1.-weight;
 if(effect==1){float d=length((point-center)*vec2(1.,nodeSize.y/nodeSize.x));float radius=params.x*1.3;float fade=1.-smoothstep(max(0.,radius-details.x),radius+.001,d);c.a*=effectMaskLayout==1?mix(1.,fade,weight):fade;}
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
  const vertices = new Float32Array(36);
  gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW);
  const corners = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];
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
    "maskMatrix", "maskRect", "maskLimits", "effectMaskMatrix", "effectMaskRect", "effectMaskLimits",
    "effectPolygonCount", "effectPolygon[0]", "effectMaskMode", "effectMaskLayout",
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
      const rect = node.rect ?? [0, 0, asset.width, asset.height];
      for (let i = 0; i < 6; i++) {
        const a = corners[i * 2],
          b = corners[i * 2 + 1];
        const dx = (a * w - px) * sx,
          dy = (b * h - py) * sy;
        const x = (node.x ?? 0) + px + dx * cos - dy * sin;
        const y = (node.y ?? 0) + py + dx * sin + dy * cos;
        const at = i * 6;
        vertices[at] = matrix[0] * x + matrix[2] * y + matrix[4];
        vertices[at + 1] = matrix[1] * x + matrix[3] * y + matrix[5];
        vertices[at + 2] = (rect[0] + a * rect[2]) / asset.width;
        vertices[at + 3] = (rect[1] + b * rect[3]) / asset.height;
        vertices[at + 4] = a;
        vertices[at + 5] = b;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
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
      const clipping=maskLayout(node.mask,mask,node),effectLayout=maskLayout(material.mask,effectMask,node),effectPolygon=material.mask?.polygon ?? [];
      gl.uniformMatrix3fv(u.maskMatrix,false,clipping.matrix);gl.uniform4fv(u.maskRect,clipping.rect);gl.uniform4fv(u.maskLimits,clipping.limits);
      gl.uniformMatrix3fv(u.effectMaskMatrix,false,effectLayout.matrix);gl.uniform4fv(u.effectMaskRect,effectLayout.rect);gl.uniform4fv(u.effectMaskLimits,effectLayout.limits);
      gl.uniform1i(u.effectPolygonCount,effectPolygon.length);if(effectPolygon.length)gl.uniform2fv(u["effectPolygon[0]"],new Float32Array(effectPolygon.flat()));
      gl.uniform1i(u.effectMaskMode,material.mask?.invert?1:0);gl.uniform1i(u.effectMaskLayout,material.mask?1:0);
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
