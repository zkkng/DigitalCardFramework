import { createPlayerStage } from "./player.js";
import {
  mountPresentation,
  validatePresentationReference,
} from "./integration.js";
import { directoryResolver } from "./resolver.js";

/** Renderer replacement for framework UI or any DOM host. Posters are the grid default. */
export function createCardRenderer({
  fallbackRenderer,
  mode = "poster",
  quality = "lite",
  resolve = directoryResolver,
  budget,
  adapters = [],
  preloadMargin = "300px",
  onDiagnostic = () => {},
} = {}) {
  if (!customElements.get("dc-portable-card"))
    customElements.define(
      "dc-portable-card",
      class extends HTMLElement {
        connectedCallback() {
          this._start?.();
        }
        disconnectedCallback() {
          this._stop?.();
        }
      },
    );
  return (copy, { onSelect } = {}) => {
    if (!copy.definition.presentation)
      return (
        fallbackRenderer?.(copy, { onSelect }) ?? document.createElement("span")
      );
    validatePresentationReference(copy.definition.presentation);
    const node = document.createElement("dc-portable-card");
    node.className = "dc-card";
    node.tabIndex = 0;
    node.setAttribute("role", onSelect ? "button" : "img");
    node.setAttribute("aria-label", copy.definition.name);
    Object.assign(node.style, {
      display: "block",
      position: "relative",
      aspectRatio: "2 / 3",
      overflow: "hidden",
      padding: "0",
    });
    const art = document.createElement("div");
    Object.assign(art.style, { position: "absolute", inset: "0" });
    const caption = document.createElement("span");
    caption.className = "dc-card-title";
    caption.textContent = copy.definition.name;
    caption.style.zIndex = "2";
    node.append(art, caption);
    let current = null,
      pendingInputs = {},
      pendingSide = "front",
      observer = null,
      disposed = false;
    const load = async () => {
      if (disposed || current || !node.isConnected) return;
      const state = { controller: new AbortController() };
      current = state;
      try {
        if (mode === "poster") {
          const ref = copy.definition.presentation;
          state.resolver = await resolve(ref.baseURL, {
            digest: ref.digest,
            signal: state.controller.signal,
          });
          if (state.controller.signal.aborted) {
            state.resolver.dispose();
            return;
          }
          const poster = await state.resolver.asset(
            state.resolver.manifest.faces.front.poster,
          );
          if (state.controller.signal.aborted) return;
          const image = document.createElement("img");
          image.src = poster.url;
          image.alt = state.resolver.manifest.faces.front.description;
          image.loading = "lazy";
          Object.assign(image.style, {
            width: "100%",
            height: "100%",
            objectFit: "cover",
          });
          art.append(image);
        } else {
          state.stage = createPlayerStage({
            root: art,
            budget,
            adapters,
            onDiagnostic,
          });
          state.view = await mountPresentation({
            stage: state.stage,
            target: art,
            definition: copy.definition,
            resolve,
            quality,
            signal: state.controller.signal,
          });
          if (state.controller.signal.aborted) {
            state.view.dispose();
            return;
          }
          state.view.setInputs(pendingInputs);
          await state.view.ready;
          if (!state.controller.signal.aborted) state.view.setSide(pendingSide);
        }
      } catch (error) {
        if (!state.controller.signal.aborted) {
          onDiagnostic({ type: "fallback", reason: error.message });
          art.textContent = "Preview unavailable";
        }
      }
    };
    node._start = () => {
      if (disposed || observer || current) return;
      if (typeof IntersectionObserver === "undefined") {
        load();
        return;
      }
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) load();
          else release();
        },
        { rootMargin: preloadMargin },
      );
      observer.observe(node);
    };
    const release = () => {
      if (current) {
        current.controller.abort();
        current.view?.dispose();
        current.stage?.dispose();
        current.resolver?.dispose();
        current = null;
      }
      art.replaceChildren();
    };
    node._stop = () => {
      observer?.disconnect();
      observer = null;
      release();
    };
    node.setPresentationInputs = (input) => {
      pendingInputs = { ...pendingInputs, ...input };
      current?.view?.setInputs(pendingInputs);
    };
    node.setPresentationSide = (side) => {
      pendingSide = side;
      return current?.view?.setSide(side);
    };
    node.dispose = () => {
      disposed = true;
      node._stop();
    };
    node.addEventListener("click", () => onSelect?.(copy));
    node.addEventListener("keydown", (event) => {
      if (onSelect && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        onSelect(copy);
      }
      if (event.key.toLowerCase() === "f")
        current?.view?.setSide(
          (node.dataset.side = node.dataset.side === "back" ? "front" : "back"),
        );
    });
    return node;
  };
}
