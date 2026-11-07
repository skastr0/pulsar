# Effect pack: hand-checked layer graphs (#659)

These are the facts the syntactic lane must emit for one real module in each corpus, worked out by
hand from the source. Each one is checked against the type the module declares. Ids are written
symbolically (`L1`, `fn@708`): the numeric ids are whatever the extractor assigns. The relations
are the ones in FACTS.md, "Effect pack". The extractor's tests compare against these graphs.

Conventions used below:

- Every Layer constructor or composition expression is one layer. A binding (`const`, a static
  field, a same-file function returning the expression) aliases that layer, so it does not
  create a new one.
- `LP outer inner mode`: `outer` is the layer the composition expression denotes, and there is one
  edge to each operand. `A.pipe(Layer.provide(B))` gives `LP X A 1` and `LP X B 1`.
- A layer named in an active catalog's `layers` gets `LY` rows from its `builds`. Only
  uncatalogued external layers and computed layers are `LO`.

## 1. Junto: `src/core/settings/service.ts` (junto bfc7b01 snapshot)

| Fact | Source |
|---|---|
| `SV SettingsService` | service.ts:62 `class SettingsService extends Context.Service<…>` |
| `SV CredentialBindingRepository` | credentials/bindings.ts:67 |
| `SV MachineConfigurationRepository` | machines/configuration.ts:37 |
| `SV StateEngine` | state/service.ts:55 |
| `SV SqlClient` (external, kind 0) | catalog `services`: `effect/sql#SqlClient.SqlClient` |
| `LY L1 CredentialBindingRepository`, `LQ L1 SqlClient`, `LC L1 fn@74` | bindings.ts:74 `static readonly layer = Layer.effect(this, Effect.gen(…))`, :75 `yield* SqlClient.SqlClient` |
| `LY L2 MachineConfigurationRepository`, `LQ L2 SqlClient`, `LC L2 fn@41` | configuration.ts:41, :42 |
| `LY L3 SettingsService`, `LQ L3 StateEngine`, `LC L3 fn@708` | service.ts:706 `Layer.effect(SettingsService, Effect.gen(…))`, :709 `yield* StateEngine` |
| `LP L4 L3 1`, `LP L4 L1 1`, `LP L4 L2 1` | service.ts:713 `.pipe(Layer.provide([CredentialBindingRepository.layer, MachineConfigurationRepository.layer]))`: the array form, one edge per element; the two static `.layer` fields resolve across files through the imports |
| `makeSettingsLive` and `SettingsLive` alias L4 | :703 is an arrow whose body is L4; :719 `SettingsLive = makeSettingsLive()` is a same-file call of it; core-product.ts:67 `makeSettingsLive()` resolves through the import |
| `US fn@385 SqlClient`, `US fn@385 CredentialBindingRepository`, `US fn@385 MachineConfigurationRepository` | service.ts:385 `makeSettingsService`'s generator, :386 to :388 |
| `US fn@708 StateEngine` (an `LC` function, so it is not counted as a hub use) | :709 |

**Check:** the requirements of L4 are the `LQ` rows of the layers it reaches (L1, L2, L3), minus
what they build (`LY`): {SqlClient, StateEngine} minus {CredentialBindingRepository,
MachineConfigurationRepository, SettingsService} = {StateEngine, SqlClient}. That equals the
declared type at service.ts:705, `Layer.Layer<SettingsService, SettingsError, StateEngine |
SqlClient.SqlClient>`.

**What the syntactic lane misses:** L3's constructor reaches SqlClient, CredentialBindingRepository
and MachineConfigurationRepository only through `yield* makeSettingsService(…)` (:710), a call
into a repo function, so `LQ` does not list them for L3. The miss is sound, because it only loses
findings. Here it changes nothing: L1 and L2 require SqlClient anyway, and L4 provides the two
repositories. The type lane makes `LQ` exact.

## 2. Effect: `ai-docs/src/01_effect/03_services/20_layer-composition.ts` (effect 9428e17)

| Fact | Source |
|---|---|
| `LY L1 PgClient`, `LY L1 SqlClient` (catalog layer, not `LO`) | :16 `SqlClientLayer = PgClient.layerConfig(…)`; catalog `layers`: `@effect/sql-pg#PgClient.layerConfig` builds PgClient and SqlClient |
| `SV UserRepository` | :24 |
| `LY L2 UserRepository`, `LQ L2 SqlClient`, `LC L2 fn@38` | :36 `layerNoDeps = Layer.effect(this, Effect.gen(…))`, :39 `yield* SqlClient.SqlClient` (the `sql<…>` template at :42 is a class-1 query site, not a graph fact) |
| `LP L3 L2 1`, `LP L3 L1 1` | :58 to :59 `layer = this.layerNoDeps.pipe(Layer.provide(SqlClientLayer))` |
| `LP L4 L2 2`, `LP L4 L1 2` | :67 to :68 `layerWithSqlClient = this.layerNoDeps.pipe(Layer.provideMerge(SqlClientLayer))` |

**Check:** L3 requires {SqlClient} minus {UserRepository, PgClient, SqlClient}, which is the empty
set. The declared type `Layer.Layer<UserRepository, ConfigError | SqlError>` at :55 has no
requirement channel. L4 is also the empty set, matching the declared type at :64. The detectors
report no unprovided service at a root given L3 or L4. Under mode-blind walking, L1 and L2 are
both reachable but build different services, so there is no duplicate builder.

## 3. Legacy Pulsar: `packages/ts-pack/src/ts-analysis.ts` (pulsar 927ab7a)

| Fact | Source |
|---|---|
| `SV TsAnalysisTag`, `SV TsPackageInfoTag` | :68, :72 |
| `LO L1` | :100 `Layer.effectContext(Effect.gen(… Context.make(TsAnalysisTag, …).pipe(Context.add(TsPackageInfoTag, …))))`: the services are put in a Context built at run time, so the adapter cannot see what the layer builds |
|  | The extractor emits no row for L1: it is unnamed, and its only use is inside L2's `Layer.unwrap` generator, which is opaque itself. Nothing names L1, so no detector could reach it. |
| `LO L2` | :117 `TsAnalysisLayer = (…) => Layer.unwrap(Effect.gen(…))`: an effect computes the layer |
| `LY L3 TsPackageInfoTag`, `LO L3` | :127 `Layer.effect(TsPackageInfoTag, discoverPackages(worktreePath))`: the service is known, but the constructor is a call into a repo function, not a generator, so there is no `LC` and its requirements are not visible |

**Check:** the declared types, `Layer<TsAnalysisTag | TsPackageInfoTag, …>` at :116 and
`Layer<TsPackageInfoTag>` at :126, are consistent with what is visible. A root reaching L1, L2 or
L3 prints `LOPQ` and reports nothing missing. That is the sound answer for layers whose
composition is hidden.
