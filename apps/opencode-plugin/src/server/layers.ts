import type { PluginInput } from "@opencode-ai/plugin"
import { Layer } from "effect"
import { makeServerLoggerLayer } from "../shared/logger"
import {
  PluginConfig,
  type PluginOptions,
  pluginConfigLayer,
} from "../shared/options"
import { toolPolicyLive } from "../shared/policy"
import { PluginLogger } from "../shared/logger"
import { ToolPolicy } from "../shared/policy"

export type ServerRuntimeEnv = PluginConfig | PluginLogger | ToolPolicy

export const makeServerLayer = ({
  input,
  options,
}: {
  readonly input: PluginInput
  readonly options: PluginOptions
}): Layer.Layer<ServerRuntimeEnv> => {
  const configLayer = pluginConfigLayer(options)

  return Layer.mergeAll(
    configLayer,
    makeServerLoggerLayer(input.client),
    toolPolicyLive.pipe(Layer.provide(configLayer)),
  )
}
