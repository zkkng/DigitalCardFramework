/** Optional server-side wallet/chain bridge. It does not mint, trade or grant local copies. */
import { SiweMessage, generateNonce } from "siwe";
import { getAddress, Contract } from "ethers";
import { ensure } from "./data.js";

export function walletSessions({
  domain,
  uri,
  chainIds,
  clock = Date.now,
  ttlMs = 300000,
  nonces = new Map(),
}) {
  ensure(
    domain && uri && Array.isArray(chainIds),
    "SIWE",
    "Host SIWE policy required",
  );
  return {
    challenge(sessionId) {
      const nonce = generateNonce();
      nonces.set(sessionId, { nonce, expires: clock() + ttlMs });
      return {
        domain,
        uri,
        nonce,
        version: "1",
        issuedAt: new Date(clock()).toISOString(),
        expirationTime: new Date(clock() + ttlMs).toISOString(),
      };
    },
    async verify(sessionId, { message, signature }) {
      const record = nonces.get(sessionId);
      ensure(record && record.expires > clock(), "SIWE", "Challenge expired");
      const parsed = new SiweMessage(message);
      ensure(
        parsed.domain === domain &&
          parsed.uri === uri &&
          chainIds.includes(parsed.chainId) &&
          parsed.nonce === record.nonce,
        "SIWE",
        "Challenge policy mismatch",
      );
      const result = await parsed.verify({
        signature,
        domain,
        nonce: record.nonce,
        time: new Date(clock()).toISOString(),
      });
      ensure(
        result.success && nonces.get(sessionId) === record,
        "SIWE",
        "Invalid or replayed signature",
      );
      nonces.delete(sessionId);
      return {
        address: getAddress(parsed.address),
        chainId: parsed.chainId,
        verifiedAt: clock(),
      };
    },
  };
}
export function tokenIdentity({ chainId, standard, contract, tokenId }) {
  ensure(
    Number.isSafeInteger(chainId) &&
      chainId > 0 &&
      ["erc721", "erc1155"].includes(standard) &&
      typeof tokenId === "string" &&
      /^(0|[1-9]\d*)$/.test(tokenId) &&
      BigInt(tokenId) < 2n ** 256n,
    "TOKEN",
    "Invalid token identity",
  );
  const address = getAddress(contract);
  return {
    chainId,
    standard,
    contract: address,
    tokenId,
    id: `eip155:${chainId}/${standard}:${address}/${tokenId}`,
  };
}

export async function resolveExternalOwnership(
  binding,
  { provider, account, confirmations = 12, clock = Date.now },
) {
  const identity = tokenIdentity(binding),
    address = getAddress(account);
  ensure(
    Number.isInteger(confirmations) && confirmations >= 1,
    "FINALITY",
    "Positive confirmation policy required",
  );
  ensure(
    Number((await provider.getNetwork()).chainId) === identity.chainId,
    "CHAIN",
    "Provider chain mismatch",
  );
  const head = await provider.getBlockNumber(),
    height = head - confirmations + 1;
  ensure(height >= 0, "FINALITY", "Insufficient chain history");
  const block = await provider.getBlock(height);
  ensure(block?.hash, "CHAIN", "Missing confirmed block");
  const state = await provider.readToken(identity, address, height);
  const check = await provider.getBlock(height);
  if (check?.hash !== block.hash)
    return {
      identity,
      state: "reorg",
      quantity: "0",
      blockNumber: height,
      blockHash: block.hash,
      checkedAt: clock(),
      authority: "external",
    };
  const quantity =
    identity.standard === "erc721"
      ? getAddress(state.owner) === address
        ? "1"
        : "0"
      : BigInt(state.balance).toString();
  ensure(BigInt(quantity) >= 0n, "TOKEN", "Invalid balance");
  return {
    identity,
    account: address,
    state: "confirmed",
    quantity,
    blockNumber: height,
    blockHash: block.hash,
    confirmations,
    checkedAt: clock(),
    authority: "external",
  };
}
export function externalOwnershipState(
  snapshot,
  { maxAgeMs = 60000, clock = Date.now } = {},
) {
  return {
    ...snapshot,
    state: clock() - snapshot.checkedAt > maxAgeMs ? "stale" : snapshot.state,
    localTransferAllowed: false,
  };
}
export function ethersOwnershipProvider(provider) {
  return {
    getNetwork: () => provider.getNetwork(),
    getBlockNumber: () => provider.getBlockNumber(),
    getBlock: (n) => provider.getBlock(n),
    async readToken(identity, account, blockTag) {
      const contract = new Contract(
        identity.contract,
        identity.standard === "erc721"
          ? ["function ownerOf(uint256) view returns (address)"]
          : ["function balanceOf(address,uint256) view returns (uint256)"],
        provider,
      );
      return identity.standard === "erc721"
        ? { owner: await contract.ownerOf(identity.tokenId, { blockTag }) }
        : {
            balance: await contract.balanceOf(account, identity.tokenId, {
              blockTag,
            }),
          };
    },
  };
}
export function marketplaceMetadata({
  title,
  description,
  posterURL,
  viewerURL,
  attributes = [],
}) {
  for (const url of [posterURL, viewerURL])
    ensure(
      new URL(url).protocol === "https:",
      "METADATA",
      "Public HTTPS media required",
    );
  return {
    name: title,
    description,
    image: posterURL,
    external_url: viewerURL,
    animation_url: viewerURL,
    attributes,
  };
}
