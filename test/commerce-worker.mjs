import { parentPort, workerData } from "node:worker_threads";
import { CardFramework } from "../src/index.js";
import { SQLiteStore } from "../src/sqlite.js";
const core = new CardFramework({ store: new SQLiteStore(workerData.db) });
parentPort.postMessage("ready");
parentPort.once("message", () => {
  try {
    const result =
      workerData.kind === "claim"
        ? core.claimAction({ permissions: ["actions.dispatch"] })
        : core.buyListing(workerData.actor, {
            ...workerData.quote,
            key: workerData.key,
          });
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error.code });
  } finally {
    core.close();
    parentPort.close();
  }
});
