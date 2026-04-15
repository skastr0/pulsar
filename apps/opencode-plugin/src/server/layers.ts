import type { PluginInput } from "@opencode-ai/plugin"
import { Layer } from "effect"
import { makeServerLoggerLayer } from "../shared/logger"
import {
  PluginConfig,
  type PluginOptions,
  pluginConfigLayer,
} from "../shared/options"
import { ToolPolicyLive } from "../shared/policy"
import { PluginLogger } from "../shared/logger"
import { ToolPolicy } from "../shared/policy"

export type ServerRuntimeEnv = PluginConfig | PluginLogger | ToolPolicy

export const makeServerLayer = ({
  input,
  options,
}: {
  readonly input: PluginInput
  readonly options: PluginOptions
}) => {
  const configLayer = pluginConfigLayer(options)

  return Layer.mergeAll(
    configLayer,
    makeServerLoggerLayer(input.client),
    ToolPolicyLive.pipe(Layer.provide(configLayer)),
  )
}
