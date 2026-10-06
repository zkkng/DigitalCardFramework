import { mountStudio } from "./presentation/studio.js";
import { blankPackage } from "./presentation/project.js";
import { importPackage } from "./presentation/package.js";
import {
  configureAuthoring,
  createLocalLibrary,
  createSharedLibrary,
  combineLibraries,
  loadTemplate,
} from "./presentation/authoring-tools.js";
import { mountCardPolicyAdmin } from "./card-policy-ui.js";

export function mountVisualStudio(
  root,
  { client, model, onCatalogChange = () => {} },
) {
  let studio,
    disposed = false,
    destination = model.catalog.cards[0]?.id,
    variantId,packArtworkDraft={},editorGeneration=0,cancelReview;
  const abort = new AbortController(),
    status = document.createElement("p"),
    select = document.createElement("select"),
    kind = document.createElement("select"),
    packFields = document.createElement("fieldset"),
    reveal = document.createElement("input"),
    artworkAlt = document.createElement("input"),
    variants = document.createElement("select"),
    launch = document.createElement("button"),
    fresh = document.createElement("button"),
    canvas = document.createElement("div");
  status.setAttribute("role", "status");
  select.setAttribute("aria-label", "Destination card");
  variants.setAttribute("aria-label", "Destination variant");
  kind.setAttribute("aria-label","Design destination");
  for(const [value,label] of [["card","Card or variant"],["pack","Pack artwork"]]){const option=document.createElement("option");option.value=value;option.textContent=label;kind.append(option);}
  const legend=document.createElement("legend");legend.textContent="Pack artwork";
  reveal.setAttribute("aria-label","Pack reveal artwork URL");reveal.placeholder="https://assets.example/reveal.webp";
  artworkAlt.setAttribute("aria-label","Pack artwork description");artworkAlt.maxLength=200;
  reveal.oninput=()=>{if(reveal.value)packArtworkDraft.reveal=reveal.value;else delete packArtworkDraft.reveal;};
  artworkAlt.oninput=()=>{if(artworkAlt.value)packArtworkDraft.alt=artworkAlt.value;else delete packArtworkDraft.alt;};
  packFields.append(legend,reveal,artworkAlt);packFields.hidden=true;
  function destinationOptions(){
  select.replaceChildren();
  select.setAttribute("aria-label",kind.value==="pack"?"Destination pack":"Destination card");
  for (const card of kind.value==="pack"?model.catalog.products:model.catalog.cards) {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.name;
    select.append(option);
  }
  destination=select.value;
  }
  destinationOptions();
  function variantOptions() {
    variants.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Base card design";
    variants.append(all);
    for (const v of model.catalog.variants.filter(
      (v) => v.cardId === destination,
    )) {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = v.name ?? v.id;
      variants.append(o);
    }
    variantId = undefined;
  }
  variantOptions();
  function resetEditor(){
    if(disposed)return;
    editorGeneration++;cancelReview?.();studio?.dispose();studio=undefined;canvas.replaceChildren();
    launch.disabled=fresh.disabled=kind.disabled=select.disabled=variants.disabled=false;
    canvas.inert=false;canvas.removeAttribute("aria-busy");
    status.textContent="Open the selected destination to edit its design.";
  }
  select.onchange = () => {
    if(disposed)return;
    resetEditor();
    destination = select.value;
    variantOptions();
  };
  variants.onchange = () => {
    if(disposed)return;
    resetEditor();
    variantId = variants.value || undefined;
  };
  kind.onchange=()=>{
    if(disposed)return;
    resetEditor();
    destinationOptions();variantOptions();variants.hidden=kind.value==="pack";
    packFields.hidden=kind.value!=="pack";
    launch.textContent=kind.value==="pack"?"Open visual pack editor":"Open visual card editor";
    fresh.textContent=kind.value==="pack"?"Start a new pack design":"Start a new card design";
  };
  launch.textContent = "Open visual card editor";
  fresh.textContent = "Start a new card design";
  launch.type = fresh.type = "button";
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("./presentation/studio.css", import.meta.url).href;
  root.append(stylesheet, kind, select, variants, packFields, launch, fresh, status, canvas);
  const canShare =
    model.me.role === "admin" ||
    model.me.permissions?.includes("card-policies.manage");
  const getDestinationPolicy = target => target.kind==="pack"?Promise.resolve(null):
    client.effectiveCardPolicy({
      cardId: target.id,
      ...(target.variantId ? { variantId:target.variantId } : {}),
    });
  const destinationPolicy=()=>getDestinationPolicy({kind:kind.value,id:destination,variantId});
  async function json(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      signal: abort.signal,
      ...options,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.message ?? result.code ?? "Presentation request failed",
      );
    return result;
  }
  async function download(digest) {
    const response = await fetch("/presentations/" + digest + "/download", {
      credentials: "same-origin",
      signal: abort.signal,
    });
    if (!response.ok)
      throw new Error(
        "Saved presentation is unavailable on this host. Import its .dcard file to edit it.",
      );
    return new Uint8Array(await response.arrayBuffer());
  }
  async function upload(pkg) {
    const headers = {
      "X-DC-Principal": model.me.userId,
      "Content-Type": "application/zip",
      "Idempotency-Key": pkg.digest,
    };
    let job = await json("/presentations/imports", {
      method: "POST",
      headers,
      body: pkg.archive,
    });
    for (
      let n = 0;
      !["ready", "published", "rejected", "cancelled"].includes(job.state) &&
      n < 120;
      n++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (disposed) throw new Error("Editor closed");
      job = await json("/presentations/imports/" + job.id);
    }
    if (!["ready", "published"].includes(job.state))
      throw new Error(job.error?.message ?? "Presentation is not ready");
    await json("/presentations/imports/" + job.id + "/publish", {
      method: "POST",
      headers: { "X-DC-Principal": model.me.userId },
    });
  }
  const shared = createSharedLibrary({
    client: {
      ...client,
      cardPolicies: async () => {
        if(kind.value==="pack")return client.cardPolicies();
        const e = await destinationPolicy();
        return { revision: e.revision, resources: e.resources };
      },
    },
    upload,
    download,
  });
  const library = combineLibraries(createLocalLibrary(), shared, { canShare });
  async function publish(pkg,mountedTarget) {
    const target = mountedTarget.id,
      targetVariant = mountedTarget.variantId,targetKind=mountedTarget.kind,publishingStudio=studio,draftArtwork=structuredClone(packArtworkDraft),
      current=()=>!disposed&&mountedTarget.generation===editorGeneration&&studio===publishingStudio;
    if(!current())return false;
    kind.disabled=select.disabled=variants.disabled=true;
    try {
    await upload(pkg);
    if(!current())return false;
    const base = await client.operatorCatalog(),
      card = base.cards.find((c) => c.id === target);
    if(!current())return false;
    if (targetKind==="card"&&!card) throw new Error("Choose a destination card");
    const values = publishingStudio.getProject().manifest.authoring?.values ?? {},
      presentation = {
        contract: "digital-card@0.1",
        digest: pkg.digest,
        baseURL: location.origin + "/presentations/" + pkg.digest + "/files/",
      };
    const revised = targetKind==="card"?{
      ...card,
      name: pkg.manifest.title,
      stats: values.card ?? {},
      ...(!targetVariant ? { presentation } : {}),
    }:null;
    const variant = targetVariant
      ? base.variants.find((v) => v.id === targetVariant && v.cardId === target)
      : null;
    if (targetVariant && !variant)
      throw new Error("Destination variant changed");
    let source = {
      cards: [revised],
      ...(variant
        ? {
            variants: [
              { ...variant, stats: values.variant ?? {}, presentation },
            ],
          }
        : {}),
    };
    let product;
    if(targetKind==="pack"){
      product=base.products.find(p=>p.id===target);if(!product)throw new Error("Choose a destination pack");
      const poster=face=>presentation.baseURL+pkg.manifest.assets.find(a=>a.id===pkg.manifest.faces[face].poster).path;
      source={products:[{...product,name:pkg.manifest.title,revision:product.revision+1,artwork:{...product.artwork,...draftArtwork,front:poster("front"),back:poster("back"),design:presentation}}]};
      if(!draftArtwork.reveal)delete source.products[0].artwork.reveal;
      if(!draftArtwork.alt)delete source.products[0].artwork.alt;
    }
    const prepared = await client.previewImport({
      source,
      expectedVersion: base.version,
    });
    if(!current())return false;
    const review = document.createElement("dialog"),
      message = document.createElement("p"),
      commit = document.createElement("button"),
      cancel = document.createElement("button");
    message.textContent = targetKind==="pack"?
      "Publish "+pkg.manifest.title+" as pack revision "+(product.revision+1)+"? Already allocated packs retain their prior artwork.":
      "Publish " +
      (revised?.name??pkg.manifest.title) +
      " under policy revision " +
      prepared.policyRevision +
      "? Existing copies retain their recorded content.";
    commit.textContent = targetKind==="pack"?"Publish reviewed pack artwork":"Publish reviewed card";
    cancel.textContent = "Keep as draft";
    review.append(message, commit, cancel);
    root.append(review);
    review.showModal();
    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        review.close();
        review.remove();
        abort.signal.removeEventListener("abort", cancelled);
        if(cancelReview===cancelled)cancelReview=undefined;
      };
      const cancelled = () => {
        cleanup();
        resolve(false);
      };
      cancel.onclick = cancelled;
      cancelReview=cancelled;
      review.addEventListener("cancel", cancelled, { once: true });
      abort.signal.addEventListener("abort", cancelled, { once: true });
      commit.onclick = async () => {
        if(!current()){cancelled();return;}
        commit.disabled = true;
        try {
          await client.commitImport({
            key: "visual:" + prepared.digest,
            manifest: prepared.manifest,
            digest: prepared.digest,
            expectedVersion: base.version,
            policyRevision: prepared.policyRevision,
          });
          cleanup();
          if(current()){
            status.textContent = targetKind==="pack"?"Pack artwork published. Existing packs retain their artwork.":"Card published.";
            onCatalogChange();
          }
          resolve(true);
        } catch (e) {
          cleanup();
          reject(e);
        }
      };
    });
    } finally {if(current())kind.disabled=select.disabled=variants.disabled=false;}
  }
  async function open(makeNew = false) {
    if (disposed) return;
    resetEditor();
    const target={kind:kind.value,id:destination,variantId,generation:++editorGeneration},current=()=>!disposed&&target.generation===editorGeneration;
    launch.disabled = fresh.disabled = true;
    kind.disabled=select.disabled=variants.disabled=true;
    canvas.inert = true;
    canvas.setAttribute("aria-busy", "true");
    try {
      const catalog = await client.operatorCatalog();
      if (!current()) return;
      const card = catalog.cards.find((c) => c.id === target.id),
        product=target.kind==="pack"?catalog.products.find(p=>p.id===target.id):undefined,
        variant = catalog.variants.find((v) => v.id === target.variantId),
        policy = await getDestinationPolicy(target);
      if (!current()) return;
      const ref = product?.artwork?.design ?? variant?.presentation ?? card?.presentation;
      let initialPackage;
      if (!makeNew && ref)
        initialPackage = await importPackage(await download(ref.digest));
      else if (policy?.policy.defaults.template) {
        const entry = await library.get(policy.policy.defaults.template, true);
        if(!current())return;
        if (!entry) throw new Error("Default template is unavailable");
        initialPackage = await loadTemplate(entry);
      } else initialPackage = await blankPackage();
      if (!current()) return;
      initialPackage.manifest.title = product?.name ?? card?.name ?? "Untitled card";
      if(product){packArtworkDraft=structuredClone(product.artwork??{});reveal.value=packArtworkDraft.reveal??"";artworkAlt.value=packArtworkDraft.alt??"";}
      studio?.dispose();
      studio = mountStudio(canvas, {
        initialPackage,
        policyProvider: target.kind==="card"?()=>getDestinationPolicy(target):undefined,
        library,
        onPublish: pkg=>publish(pkg,target),
      });
      await studio.ready;
      if (!current()) return;
      if(policy)configureAuthoring(studio.getProject(), {
        policy: policy.policy,
        policyRevision: policy.revision,
        context: policy.context,
      });
      if(policy)studio.getProject().edit((p) => {
        p.manifest.authoring.values.card = {
          ...p.manifest.authoring.values.card,
          ...card?.stats,
        };
        p.manifest.authoring.values.variant = {
          ...p.manifest.authoring.values.variant,
          ...variant?.stats,
        };
      });
      await studio.refreshPolicy();
      if (!current()) return;
      status.textContent =
        product?"Edit pack front and back, capture posters, then publish reviewed artwork. Reveal art is an optional image URL.":"Edit the card, capture its posters, then publish a reviewed revision.";
    } catch (e) {
      if (current()) status.textContent = e.message;
    } finally {
      if (current()) {
        launch.disabled = fresh.disabled = false;
        kind.disabled=select.disabled=variants.disabled=false;
        canvas.inert = false;
        canvas.removeAttribute("aria-busy");
      }
    }
  }
  launch.onclick = () => open();
  fresh.onclick = () => open(true);
  let admin;
  if (canShare) {
    const panel = document.createElement("details"),
      summary = document.createElement("summary"),
      body = document.createElement("div");
    summary.textContent = "Administrator card policies";
    panel.append(summary, body);
    root.append(panel);
    admin = mountCardPolicyAdmin(body, { client });
  }
  return {
    dispose() {
      disposed = true;
      editorGeneration++;cancelReview?.();
      abort.abort();
      studio?.dispose();
      admin?.dispose();
      root.replaceChildren();
    },
  };
}
