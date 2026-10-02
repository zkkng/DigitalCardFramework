import { createRemoteActionHandler } from "@digital-card/framework/remote-actions";

export const actionHandlers = {
  "example.record": createRemoteActionHandler({
    url: process.env.ACTION_PLUGIN_URL,
    pluginId: "example.receiver",
    handlerId: "example.record",
    token: process.env.ACTION_PLUGIN_TOKEN,
  }),
};
