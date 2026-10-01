import { ensure, canonical, clamp } from "./data.js";
/** Serve reviewed programs from this origin with these HTTP response headers. */
export function programHeaders(assetOrigin) {
  const origin = new URL(assetOrigin).origin;
  return {
    "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'self'; img-src ${origin} blob: data:; media-src ${origin} blob:; connect-src 'none'; font-src ${origin}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors https: http:; sandbox allow-scripts`,
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Reviewed host registry only; arbitrary uploaded HTML is never executed by .dcard. */
export function mountProgram(
  root,
  {
    programId,
    registry,
    inputs = {},
    onIntent = () => {},
    maxMessagesPerSecond = 30,
    handshakeTimeout = 5000,
  },
) {
  const entry = registry.get(programId);
  ensure(
    entry?.approved && entry.url && entry.version,
    "PROGRAM",
    "Program not approved",
  );
  const url = new URL(entry.url);
  ensure(
    url.origin !== location.origin &&
      ["http:", "https:"].includes(url.protocol),
    "PROGRAM_ORIGIN",
    "Program must use a separate HTTP origin",
  );
  let frame,
    port,
    timer,
    disposed = false,
    lastInputs = inputs,
    windowStart = performance.now(),
    count = 0;
  const send = (message) => port?.postMessage(message);
  const clean = () => {
    clearTimeout(timer);
    port?.close();
    port = null;
    frame?.remove();
    frame = null;
  };
  function start() {
    if (disposed || frame) return;
    const nonce = crypto.randomUUID(),
      channel = new MessageChannel();
    frame = document.createElement("iframe");
    frame.title = entry.title ?? "Interactive card";
    frame.sandbox = "allow-scripts";
    frame.referrerPolicy = "no-referrer";
    frame.allow =
      "camera 'none'; microphone 'none'; geolocation 'none'; autoplay 'none'; payment 'none'";
    frame.src = url.href;
    Object.assign(frame.style, { border: "0", width: "100%", height: "100%" });
    root.append(frame);
    port = channel.port1;
    let ready = false;
    port.onmessage = (event) => {
      try {
        const message = event.data;
        ensure(
          canonical(message).length <= 4096,
          "PROGRAM_MESSAGE",
          "Message too large",
        );
        const now = performance.now();
        if (now - windowStart > 1000) {
          windowStart = now;
          count = 0;
        }
        ensure(
          ++count <= maxMessagesPerSecond,
          "PROGRAM_RATE",
          "Program message rate exceeded",
        );
        ensure(
          message.nonce === nonce && message.version === 1,
          "PROGRAM_MESSAGE",
          "Invalid handshake",
        );
        if (message.type === "ready") {
          ensure(!ready, "PROGRAM_MESSAGE", "Duplicate handshake");
          ready = true;
          clearTimeout(timer);
          send({
            version: 1,
            type: "inputs",
            inputs: filterInputs(lastInputs),
          });
        } else {
          ensure(
            ready &&
              message.type === "intent" &&
              entry.intents?.includes(message.intent),
            "PROGRAM_INTENT",
            "Intent not allowed",
          );
          onIntent({ intent: message.intent });
        }
      } catch {
        clean();
      }
    };
    frame.onload = () =>
      frame?.contentWindow.postMessage(
        { type: "dc.program.init", version: 1, nonce },
        "*",
        [channel.port2],
      );
    timer = setTimeout(clean, handshakeTimeout);
  }
  const visibility = () => {
    if (document.hidden) clean();
    else start();
  };
  document.addEventListener("visibilitychange", visibility);
  start();
  return {
    setInputs(value) {
      lastInputs = value;
      send({ version: 1, type: "inputs", inputs: filterInputs(value) });
    },
    setVisibility(value) {
      value === "visible" ? start() : clean();
    },
    dispose() {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      clean();
    },
  };
}
function filterInputs(input) {
  return {
    tilt: {
      x: clamp(Number(input.tilt?.x) || 0, -1, 1),
      y: clamp(Number(input.tilt?.y) || 0, -1, 1),
    },
    revealProgress: clamp(Number(input.revealProgress) || 0),
    flipProgress: clamp(Number(input.flipProgress) || 0),
  };
}

/** Called by the reviewed program entrypoint; source + transferred port authenticate the parent. */
export function connectProgram({ onInputs = () => {} } = {}) {
  return new Promise((resolve) => {
    const listener = (event) => {
      if (
        event.source !== parent ||
        event.data?.type !== "dc.program.init" ||
        event.data.version !== 1 ||
        typeof event.data.nonce !== "string" ||
        event.data.nonce.length > 100 ||
        event.ports.length !== 1
      )
        return;
      window.removeEventListener("message", listener);
      const port = event.ports[0],
        nonce = event.data.nonce;
      port.onmessage = (e) => {
        if (e.data?.version === 1 && e.data.type === "inputs")
          onInputs(filterInputs(e.data.inputs ?? {}));
      };
      port.postMessage({ version: 1, type: "ready", nonce });
      resolve({
        intent(name) {
          port.postMessage({ version: 1, type: "intent", nonce, intent: name });
        },
        dispose() {
          port.close();
        },
      });
    };
    window.addEventListener("message", listener);
  });
}
