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
    variantId;
  const abort = new AbortController(),
    status = document.createElement("p"),
    select = document.createElement("select"),
    variants = document.createElement("select"),
    launch = document.createElement("button"),
    fresh = document.createElement("button"),
    canvas = document.createElement("div");
  status.setAttribute("role", "status");
  select.setAttribute("aria-label", "Destination card");
  variants.setAttribute("aria-label", "Destination variant");
  for (const card of model.catalog.cards) {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.name;
    select.append(option);
  }
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
  select.onchange = () => {
    destination = select.value;
    variantOptions();
    studio?.refreshPolicy().catch((e) => (status.textContent = e.message));
  };
  variants.onchange = () => {
    variantId = variants.value || undefined;
    studio?.refreshPolicy().catch((e) => (status.textContent = e.message));
  };
  launch.textContent = "Open visual card editor";
  fresh.textContent = "Start a new card design";
  launch.type = fresh.type = "button";
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("./presentation/studio.css", import.meta.url).href;
  root.append(stylesheet, select, variants, launch, fresh, status, canvas);
  const canShare =
    model.me.role === "admin" ||
    model.me.permissions?.includes("card-policies.manage");
  const destinationPolicy = () =>
    client.effectiveCardPolicy({
      cardId: destination,
      ...(variantId ? { variantId } : {}),
    });
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
        const e = await destinationPolicy();
        return { revision: e.revision, resources: e.resources };
      },
    },
    upload,
    download,
  });
  const library = combineLibraries(createLocalLibrary(), shared, { canShare });
  async function publish(pkg) {
    const target = destination,
      targetVariant = variantId;
    await upload(pkg);
    const base = await client.operatorCatalog(),
      card = base.cards.find((c) => c.id === target);
    if (!card) throw new Error("Choose a destination card");
    const values = studio.getProject().manifest.authoring?.values ?? {},
      presentation = {
        contract: "digital-card@0.1",
        digest: pkg.digest,
        baseURL: location.origin + "/presentations/" + pkg.digest + "/files/",
      };
    const revised = {
      ...card,
      name: pkg.manifest.title,
      stats: values.card ?? {},
      ...(!targetVariant ? { presentation } : {}),
    };
    const variant = targetVariant
      ? base.variants.find((v) => v.id === targetVariant && v.cardId === target)
      : null;
    if (targetVariant && !variant)
      throw new Error("Destination variant changed");
    const source = {
      cards: [revised],
      ...(variant
        ? {
            variants: [
              { ...variant, stats: values.variant ?? {}, presentation },
            ],
          }
        : {}),
    };
    const prepared = await client.previewImport({
      source,
      expectedVersion: base.version,
    });
    const review = document.createElement("dialog"),
      message = document.createElement("p"),
      commit = document.createElement("button"),
      cancel = document.createElement("button");
    message.textContent =
      "Publish " +
      revised.name +
      " under policy revision " +
      prepared.policyRevision +
      "? Existing copies retain their recorded content.";
    commit.textContent = "Publish reviewed card";
    cancel.textContent = "Keep as draft";
    review.append(message, commit, cancel);
    root.append(review);
    review.showModal();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        review.close();
        review.remove();
        abort.signal.removeEventListener("abort", cancelled);
      };
      const cancelled = () => {
        cleanup();
        resolve(false);
      };
      cancel.onclick = cancelled;
      review.addEventListener("cancel", cancelled, { once: true });
      abort.signal.addEventListener("abort", cancelled, { once: true });
      commit.onclick = async () => {
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
          status.textContent = "Card published.";
          onCatalogChange();
          resolve(true);
        } catch (e) {
          cleanup();
          reject(e);
        }
      };
    });
  }
  async function open(makeNew = false) {
    launch.disabled = fresh.disabled = true;
    try {
      const catalog = await client.operatorCatalog(),
        card = catalog.cards.find((c) => c.id === destination),
        variant = catalog.variants.find((v) => v.id === variantId),
        policy = await destinationPolicy();
      const ref = variant?.presentation ?? card?.presentation;
      let initialPackage;
      if (!makeNew && ref)
        initialPackage = await importPackage(await download(ref.digest));
      else if (policy.policy.defaults.template) {
        const entry = await library.get(policy.policy.defaults.template, true);
        if (!entry) throw new Error("Default template is unavailable");
        initialPackage = await loadTemplate(entry);
      } else initialPackage = await blankPackage();
      initialPackage.manifest.title = card?.name ?? "Untitled card";
      studio?.dispose();
      studio = mountStudio(canvas, {
        initialPackage,
        policyProvider: destinationPolicy,
        library,
        onPublish: publish,
      });
      await studio.ready;
      configureAuthoring(studio.getProject(), {
        policy: policy.policy,
        policyRevision: policy.revision,
        context: policy.context,
      });
      studio.getProject().edit((p) => {
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
      status.textContent =
        "Edit the card, capture its posters, then publish a reviewed revision.";
    } catch (e) {
      status.textContent = e.message;
    } finally {
      launch.disabled = fresh.disabled = false;
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
      abort.abort();
      studio?.dispose();
      admin?.dispose();
      root.replaceChildren();
    },
  };
}
