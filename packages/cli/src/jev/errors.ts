import { Data } from "effect"

export class JevCompileError extends Data.TaggedError("JevCompileError")<{
  readonly reason:
    | "empty_sources"
    | "empty_preference"
    | "invalid_anchors"
    | "reserved_anchor_id"
    | "duplicate_anchor_id"
  readonly message: string
}> {}

export class JevConfigError extends Data.TaggedError("JevConfigError")<{
  readonly reason: "missing_api_key"
  readonly message: string
}> {}

export class JevTransportError extends Data.TaggedError("JevTransportError")<{
  readonly reason: "network_or_timeout"
}> {}

export class JevHttpError extends Data.TaggedError("JevHttpError")<{
  readonly status: number
  readonly requestId: string | null
}> {}

export class JevDecodeError extends Data.TaggedError("JevDecodeError")<{
  readonly reason: "invalid_json" | "invalid_response"
  readonly message: string
}> {}

export type JevError =
  | JevCompileError
  | JevConfigError
  | JevTransportError
  | JevHttpError
  | JevDecodeError
