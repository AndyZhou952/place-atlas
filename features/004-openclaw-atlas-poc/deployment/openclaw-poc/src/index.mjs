import { createJpmapRouterClient } from "./jpmap-client.mjs";

const configurationReply = "Japan Atlas 配置不可用，请联系管理员。";
const unavailableReply = "Japan Atlas 附近查询暂时不可用，请稍后重试。";

export function createJpmapPlugin(options = {}) {
  const createRouter = options.createRouter ?? createJpmapRouterClient;
  return {
    id: "japan-atlas-jpmap",
    name: "Japan Atlas jpmap",
    description: "Model-bypassing native command client for Japan Atlas",
    register(api) {
      api.registerCommand({
        name: "jpmap",
        description: "Run the closed Japan Atlas project command",
        channels: ["openclaw-weixin"],
        acceptsArgs: true,
        requireAuth: true,
        async handler(commandContext) {
          const route = createRouter({ ...options.client, commandContext });
          let text = configurationReply;
          try {
            text = await route({
              command: typeof commandContext?.args === "string" ? commandContext.args : "",
              commandName: "jpmap",
              skillName: "jpmap",
            });
          } catch {
            text = unavailableReply;
          }
          return { text };
        },
      });
    },
  };
}

export default createJpmapPlugin();
