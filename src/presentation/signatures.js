import { ensure, canonical, utf8, parseJSON, text } from "./data.js";
import { importPackage, writeZip } from "./package.js";
const message = (digest) => utf8("digital-card-signature-v1\n" + digest);
const encode = (bytes) => btoa(String.fromCharCode(...bytes));
const decode = (value) => Uint8Array.from(atob(value), (x) => x.charCodeAt(0));

/** Trust keys are supplied by the host, never accepted from the package itself. */
export async function signPackage(archive, { keyId, privateKey }) {
  ensure(
    /^[a-zA-Z][\w.-]{0,99}$/.test(keyId),
    "SIGNATURE",
    "Invalid signing key ID",
  );
  const pkg = await importPackage(archive),
    signature = await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      message(pkg.digest),
    );
  pkg.files.set(
    `signatures/${keyId}.json`,
    utf8(
      canonical({
        version: 1,
        algorithm: "Ed25519",
        keyId,
        digest: pkg.digest,
        signature: encode(new Uint8Array(signature)),
      }),
    ),
  );
  return writeZip(pkg.files);
}
export async function verifySignatures(
  pkg,
  { keys = new Map(), requireTrusted = false } = {},
) {
  const results = [];
  for (const [path, bytes] of pkg.files) {
    if (!path.startsWith("signatures/")) continue;
    const sig = parseJSON(text(bytes));
    const key = keys.get(sig.keyId);
    const trusted =
      !!key &&
      (await crypto.subtle.verify(
        "Ed25519",
        key,
        decode(sig.signature),
        message(pkg.digest),
      ));
    results.push({ keyId: sig.keyId, trusted });
  }
  ensure(
    !requireTrusted || results.some((r) => r.trusted),
    "SIGNATURE",
    "No trusted signature",
  );
  return results;
}
