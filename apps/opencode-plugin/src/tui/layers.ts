import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { Context, Layer } from "effect"
import { PluginLogger, makeTuiLoggerLayer } from "../shared/logger"
import {
  PluginConfig,
  type PluginOptions,
  pluginConfigLayer,
} from "../shared/options"

export class TuiHost extends Context.Tag("@opencode-effect-template/TuiHost")<
  TuiHost,
  {
    readonly api: Parameters<TuiPlugin>[0]
    readonly meta: Parameters<TuiPlugin>[2]
  }
>() {}

export type TuiRuntimeEnv = TuiHost | PluginConfig | PluginLogger

export const makeTuiLayer = ({
  api,
  options,
  meta,
}: {
  readonly api: Parameters<TuiPlugin>[0]
  readonly options: PluginOptions
  readonly meta: Parameters<TuiPlugin>[2]
}): Layer.Layer<TuiRuntimeEnv> =>
  Layer.mergeAll(
    pluginConfigLayer(options),
    Layer.succeed(TuiHost, { api, meta }),
    makeTuiLoggerLayer(api),
  )
