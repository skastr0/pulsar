#!/usr/bin/env python3
"""Generate the Effect pack catalog and the Node/JS platform catalog.

Every entry is verified against a real source: the export must exist, and the
citation is the first prose line of the JSDoc above it. A missing export or a
missing export is a hard error, so the catalog cannot cite something that is not
there. Exports with no prose JSDoc cite their signature line, marked "signature:".

Run from this directory:  python3 -I gen_catalog.py            (regenerate in place)
                          python3 -I gen_catalog.py --check    (exit 1 if a file is stale)
Sources are local checkouts on the dev machine (see SRC); the outputs are committed.
"""
import os
import re
import sys

HOME = os.path.expanduser("~")
SRC = {
    # key: (root dir, citation prefix)
    "ED": (f"{HOME}/playground/effect", "effect@9428e17499:"),
    "E4": (f"{HOME}/playground/effect/packages/effect/src", "effect@9428e17499:packages/effect/src/"),
    "PG4": (f"{HOME}/playground/effect/packages/sql/pg/src", "effect@9428e17499:packages/sql/pg/src/"),
    "PN4": (f"{HOME}/playground/effect/packages/platform/node/src", "effect@9428e17499:packages/platform/node/src/"),
    "PB4": (f"{HOME}/playground/effect/packages/platform/bun/src", "effect@9428e17499:packages/platform/bun/src/"),
    "PD4": (f"{HOME}/playground/effect/packages/platform/deno/src", "effect@9428e17499:packages/platform/deno/src/"),
    "PW4": (f"{HOME}/playground/effect/packages/platform/browser/src", "effect@9428e17499:packages/platform/browser/src/"),
    "E3": (f"{HOME}/Projects/pulsar/node_modules/.bun/effect@3.21.0/node_modules/effect/src", "effect@3.21.0:src/"),
    "S3": (f"{HOME}/Projects/quasar/node_modules/.bun/@effect+sql@0.51.1+dae51d708c9c96b7/node_modules/@effect/sql/src", "@effect/sql@0.51.1:src/"),
    "NODE": (f"{HOME}/Projects/pulsar/node_modules/.bun/@types+node@25.6.0/node_modules/@types/node", "@types/node@25.6.0:"),
    "TS": (f"{HOME}/Projects/pulsar/node_modules/.bun/typescript@5.9.3/node_modules/typescript/lib", "typescript@5.9.3:lib/"),
}

_cache = {}


def lines_of(path):
    if path not in _cache:
        with open(path, encoding="utf-8") as f:
            _cache[path] = f.read().split("\n")
    return _cache[path]


def find_decl(lines, name, member_of=None):
    """Line index of the declaration of `name`, or None."""
    n = re.escape(name)
    pats = [
        rf"^export (declare )?(const|function|class|let) {n}\b",
        rf"^\s+{n}_ as {n}\b",  # `export { catch_ as catch }`: the JSDoc sits on the re-export
        rf"^\s+(export )?(declare )?(function|const) {n}\b",  # inside declare module
        rf"^const {n}_\b",  # `const catch_` later re-exported `as catch`
        rf"^const {n}\b",
    ]
    if member_of:  # interface member, e.g. DateConstructor.now / Math.random
        start = next((i for i, l in enumerate(lines) if re.match(rf"^\s*(interface|declare var) {re.escape(member_of)}\b", l)), None)
        if start is None:
            return None
        for i in range(start, min(start + 600, len(lines))):
            if re.match(rf"^\s+(readonly )?{n}\s*[(:?<]", lines[i]):
                return i
            if i > start and re.match(r"^}", lines[i]):
                break
        return None
    for p in pats:
        for i, l in enumerate(lines):
            if re.match(p, l):
                return i
    return None


def jsdoc_first(lines, decl, why=None):
    """(line index, text) of the first prose line of the JSDoc above decl that
    matches `why` (the class's justification), else the first prose line."""
    i = decl - 1
    while i >= 0 and lines[i].strip().startswith("@") is False and lines[i].strip() == "":
        i -= 1
    if i < 0 or not lines[i].strip().endswith("*/"):
        return None
    end = i
    while i >= 0 and "/**" not in lines[i]:
        i -= 1
    if i < 0:
        return None
    prose, fence = [], False
    for j in range(i, end + 1):
        t = re.sub(r"\s*\*/$", "", lines[j].strip().lstrip("/").lstrip("*").strip())
        if t.startswith("```"):
            fence = not fence
            continue
        if fence or not t or t.startswith("@") or t == "/":
            continue
        prose.append((j, t))
    if not prose:
        return None
    if why:
        for j, t in prose:
            if re.search(why, t):
                return j, t
    return prose[0]


ERRORS = []
NODOC = []


def cite(src, file, name, member_of=None, why=None):
    root, prefix = SRC[src]
    path = os.path.join(root, file)
    if not os.path.exists(path):
        ERRORS.append(f"missing file {src}:{file}")
        return None
    lines = lines_of(path)
    d = find_decl(lines, name, member_of)
    if d is None:
        ERRORS.append(f"missing export {src}:{file}#{member_of + '.' if member_of else ''}{name}")
        return None
    doc = jsdoc_first(lines, d, why)
    if doc is None:
        # No prose JSDoc on this export: cite the declaration itself, and say so.
        NODOC.append(f"{src}:{file}#{name}")
        j, text = d, "signature: " + re.sub(r"\s+", " ", lines[d].strip())
    else:
        j, text = doc
    text = text.replace("\\", "").replace('"', "'")
    if len(text) > 110:
        text = text[:107].rstrip() + "..."
    return (f"{prefix}{file}:{j + 1}", text)


# ---------------------------------------------------------------------------
# Entries. (class, sym, ver, src, file, export, via, use)
#   via:  call   = calling `sym` is the event (default)
#         ref    = any reference to `sym` (an Effect value: `yield* Clock.currentTimeMillis`);
#                  set automatically when the export's declared type is Effect<...>
#         yield  = the value bound by `yield* sym`; `use` says which use of it
#         result = the value returned by calling `sym`; `use` says which use
#         yield-result = the value bound by `yield* sym(...)`
#         read   = reading the property `sym`
#         new    = `new sym()`; use = "noargs" restricts to zero arguments
#   use:  tag | call | member:<name> | member:* | noargs
# ---------------------------------------------------------------------------
E = []


def add(cls, sym, ver, src, file, export, via="call", use=None, member_of=None):
    E.append(dict(cls=cls, sym=sym, ver=ver, src=src, file=file, export=export, via=via, use=use, member_of=member_of))


def many(cls, prefix, ver, src, file, names, **kw):
    for n in names:
        add(cls, f"{prefix}{n}", ver, src, file, n, **kw)


# error-erasing (4): the typed error is turned into a defect, dropped, or replaced.
many("error-erasing", "effect#Effect.", "4", "E4", "Effect.ts", ["orDie", "ignore", "ignoreCause", "orElseSucceed", "option"])
many("error-erasing", "effect#Effect.", "3", "E3", "Effect.ts", ["orDie", "orDieWith", "ignore", "ignoreLogged", "orElseSucceed", "option"])
add("error-erasing", "effect#Layer.orDie", "4", "E4", "Layer.ts", "orDie")
add("error-erasing", "effect#Layer.orDie", "3", "E3", "Layer.ts", "orDie")
many("error-erasing", "effect#Stream.", "4", "E4", "Stream.ts", ["orDie", "ignore"])
many("error-erasing", "effect#Stream.", "3", "E3", "Stream.ts", ["orDie"])


def decl_text(lines, i):
    """The declaration starting at line i, up to the next export or doc comment."""
    out = [lines[i]]
    for l in lines[i + 1:i + 120]:
        if re.match(r"^(export |/\*\*)", l):
            break
        out.append(l)
    return "\n".join(out)


def takes_self_alone(text):
    """Some overload's parameters are `self` plus only optional ones, so the export can be
    passed point-free (`pipe(x, Effect.orDie)`)."""
    for m in re.finditer(r"\(\s*self\s*:", text):
        # Only a parameter list that opens an overload (`const x: <..>(self` or a `<..>(self`
        # line in an overload block), never the `(self) => ..` a data-last overload returns.
        line = text[text.rfind("\n", 0, m.start()) + 1:m.end()]
        if not re.match(r"^\s*(export (declare )?const \w+\s*:\s*)?(<[^()]*>)?\s*\(\s*self\s*:$", line):
            continue
        depth, j, start = 0, m.start(), m.start() + 1
        params, cur = [], []
        while j < len(text):
            ch = text[j]
            if ch in "(<[{":
                depth += 1
                if depth > 1:
                    cur.append(ch)
            elif ch in ")>]}":
                if ch == ">" and j > 0 and text[j - 1] == "=":
                    cur.append(ch)  # the `=>` of a function type, not a closing bracket
                    j += 1
                    continue
                depth -= 1
                if depth == 0:
                    params.append("".join(cur))
                    break
                cur.append(ch)
            elif ch == "," and depth == 1:
                params.append("".join(cur))
                cur = []
            else:
                cur.append(ch)
            j += 1
        if params and all(re.match(r"\s*\w+\?\s*:", q) for q in params[1:] if q.strip()):
            return True
    return False


# Point-free uses of the unary error-erasing combinators are references, not calls: give each
# one whose signature takes `self` alone a `via = "ref"` entry too.
for e in [x for x in E if x["cls"] == "error-erasing" and x["via"] == "call"]:
    root = SRC[e["src"]][0]
    ln = lines_of(f"{root}/{e['file']}")
    i = find_decl(ln, e["export"])
    if i is not None and takes_self_alone(decl_text(ln, i)):
        E.append(dict(e, via="ref"))

# runtime-escape (5): leaves the Effect runtime and runs an effect imperatively.
many("runtime-escape", "effect#Effect.", "4", "E4", "Effect.ts", [
    "runSync", "runSyncExit", "runPromise", "runPromiseExit", "runFork", "runCallback",
    "runSyncWith", "runSyncExitWith", "runPromiseWith", "runPromiseExitWith", "runForkWith", "runCallbackWith"])
many("runtime-escape", "effect#Effect.", "3", "E3", "Effect.ts", [
    "runSync", "runSyncExit", "runPromise", "runPromiseExit", "runFork", "runCallback"])
many("runtime-escape", "effect#Runtime.", "3", "E3", "Runtime.ts", [
    "runSync", "runSyncExit", "runPromise", "runPromiseExit", "runFork", "runCallback"])
for plat, src, mod in [("platform-node", "PN4", "NodeRuntime"), ("platform-bun", "PB4", "BunRuntime"),
                       ("platform-deno", "PD4", "DenoRuntime"), ("platform-browser", "PW4", "BrowserRuntime")]:
    add("runtime-escape", f"@effect/{plat}#{mod}.runMain", "4", src, f"{mod}.ts", "runMain")
# A ManagedRuntime's run* methods escape as well; the runtime value comes from make().
for m in ["runSync", "runSyncExit", "runPromise", "runPromiseExit", "runFork", "runCallback"]:
    add("runtime-escape", "effect#ManagedRuntime.make", "4", "E4", "ManagedRuntime.ts", "make", via="result", use=f"member:{m}")
    add("runtime-escape", "effect#ManagedRuntime.make", "3", "E3", "ManagedRuntime.ts", "make", via="result", use=f"member:{m}")

# fork (6): a fiber whose lifetime is bounded by neither its parent nor a Scope.
# Absent on purpose: forkChild (v4) and fork (v3) are auto-supervised, terminated with their
# parent (their JSDoc says so); forkScoped / forkIn and FiberSet/FiberMap/FiberHandle.run are
# scoped; v3 forkAll / forkWithErrorHandler have no doc stating an unbounded lifetime.
many("fork", "effect#Effect.", "4", "E4", "Effect.ts", ["forkDetach"])
many("fork", "effect#Effect.", "3", "E3", "Effect.ts", ["forkDaemon"])

# resource-acquire (7): a resource the caller must release by hand.
many("resource-acquire", "effect#Scope.", "4", "E4", "Scope.ts", ["make", "makeUnsafe"])
many("resource-acquire", "effect#Scope.", "3", "E3", "Scope.ts", ["make"])
add("resource-acquire", "effect#ManagedRuntime.make", "4", "E4", "ManagedRuntime.ts", "make")
add("resource-acquire", "effect#ManagedRuntime.make", "3", "E3", "ManagedRuntime.ts", "make")

# ambient-read (8): process-global state read outside the service model. Effect's Clock, Random,
# DateTime.now and Config reads go through injectable services (a declared requirement), so they
# are not ambient and are absent (pulsar-research review of #660, decision 6). The unsafe DateTime
# reads call Date.now directly, bypassing Clock, so they stay.
add("ambient-read", "effect#DateTime.nowUnsafe", "4", "E4", "DateTime.ts", "nowUnsafe")
add("ambient-read", "effect#DateTime.unsafeNow", "3", "E3", "DateTime.ts", "unsafeNow")

# log (3)
many("log", "effect#Effect.", "4", "E4", "Effect.ts", ["log", "logTrace", "logDebug", "logInfo", "logWarning", "logError", "logFatal", "logWithLevel"])
many("log", "effect#Effect.", "3", "E3", "Effect.ts", ["log", "logTrace", "logDebug", "logInfo", "logWarning", "logError", "logFatal"])
many("log", "effect#Console.", "4", "E4", "Console.ts", ["log", "error", "warn", "info", "debug", "trace"])
many("log", "effect#Console.", "3", "E3", "Console.ts", ["log", "error", "warn", "info", "debug", "trace"])

# query (1): the sql client obtained from its service, and the query builders.
for ver, src, base in [("4", "E4", "effect/sql#"), ("3", "S3", "@effect/sql#")]:
    sq = "sql/SqlClient.ts" if src == "E4" else "SqlClient.ts"
    add("query", f"{base}SqlClient.SqlClient", ver, src, sq, "SqlClient", via="yield", use="tag")
    add("query", f"{base}SqlClient.SqlClient", ver, src, sq, "SqlClient", via="yield", use="member:unsafe")
add("query", "@effect/sql-pg#PgClient.PgClient", "4", "PG4", "PgClient.ts", "PgClient", via="yield", use="tag")
add("query", "@effect/sql-pg#PgClient.PgClient", "4", "PG4", "PgClient.ts", "PgClient", via="yield", use="member:unsafe")
for n in ["findAll", "findNonEmpty", "findOne", "findOneOption", "void"]:
    add("query", f"effect/sql#SqlSchema.{n}", "4", "E4", "sql/SqlSchema.ts", n, via="result", use="call")
for n in ["findAll", "findOne", "single", "void"]:
    add("query", f"@effect/sql#SqlSchema.{n}", "3", "S3", "SqlSchema.ts", n, via="result", use="call")
for n in ["ordered", "grouped", "findById", "void"]:
    add("query", f"effect/sql#SqlResolver.{n}", "4", "E4", "sql/SqlResolver.ts", n)
    add("query", f"@effect/sql#SqlResolver.{n}", "3", "S3", "SqlResolver.ts", n, via="yield-result", use="member:execute")
add("query", "effect/sql#SqlResolver.request", "4", "E4", "sql/SqlResolver.ts", "request")
add("query", "effect/sql#SqlModel.makeRepository", "4", "E4", "sql/SqlModel.ts", "makeRepository", via="yield-result", use="member:*")
add("query", "@effect/sql#Model.makeRepository", "3", "S3", "Model.ts", "makeRepository", via="yield-result", use="member:*")

# Handlers (HD facts): the function-valued argument that recovers from a failure.
HANDLERS = []


def handler(sym, ver, src, file, export, arg="last-fn"):
    HANDLERS.append(dict(sym=sym, ver=ver, src=src, file=file, export=export, arg=arg))


for n in ["catch", "catchCause", "catchDefect", "catchTag", "catchIf", "catchFilter", "catchCauseFilter", "catchReason", "catchEager"]:
    handler(f"effect#Effect.{n}", "4", "E4", "Effect.ts", n)
for n in ["catchTags", "catchReasons"]:
    handler(f"effect#Effect.{n}", "4", "E4", "Effect.ts", n, arg="object-fns")
for n in ["catchAll", "catchAllCause", "catchAllDefect", "catchSome", "catchSomeCause", "catchTag", "catchIf", "orElse"]:
    handler(f"effect#Effect.{n}", "3", "E3", "Effect.ts", n)
handler("effect#Effect.catchTags", "3", "E3", "Effect.ts", "catchTags", arg="object-fns")

# Wrappers: calls whose function-valued arguments run as Effect code (ctx bit 2, pack-defined effect context).
WRAPPERS = []
for n, label in [("gen", "none"), ("fn", "first-string"), ("fnUntraced", "none"), ("fnUntracedEager", "none")]:
    WRAPPERS.append(dict(sym=f"effect#Effect.{n}", ver="4", src="E4", file="Effect.ts", export=n, label=label))
for n, label in [("gen", "none"), ("fn", "first-string"), ("fnUntraced", "none")]:
    WRAPPERS.append(dict(sym=f"effect#Effect.{n}", ver="3", src="E3", file="Effect.ts", export=n, label=label))
# Layer.sync's thunk runs when the layer is built, so it is Effect code too. Layer.succeed takes a
# value (`resource: S`), not a thunk, so there is nothing for it to wrap.
for ver, src in [("4", "E4"), ("3", "E3")]:
    WRAPPERS.append(dict(sym="effect#Layer.sync", ver=ver, src=src, file="Layer.ts", export="sync", label="none"))

# Services with a default: always provided, so never "unprovided" (SV kind 1, file 4294967295).
SERVICES = []
for mod, name in [("Clock", "Clock"), ("Random", "Random"), ("Console", "Console")]:
    SERVICES.append(dict(sym=f"effect#{mod}.{name}", ver="4", src="E4", file=f"{mod}.ts", export=name, default=True))
for mod, name in [("Clock", "Clock"), ("Random", "Random"), ("Console", "Console")]:
    SERVICES.append(dict(sym=f"effect#{mod}.{name}", ver="3", src="E3", file=f"{mod}.ts", export=name, default=True))

# Scope inside a layer constructor: Layer.effect excludes Scope from the layer's requirements.
SERVICES.append(dict(sym="effect#Scope.Scope", ver="4", src="E4", file="Scope.ts", export="Scope", default=True,
                     why_file="Layer.ts", why_export="effect", why=r"Exclude<R, Scope\.Scope>"))
# External services without a default: recognised as services for US/LQ, never always-provided.
for sym, src, file, export in [
    ("effect/sql#SqlClient.SqlClient", "E4", "sql/SqlClient.ts", "SqlClient"),
    ("@effect/sql#SqlClient.SqlClient", "S3", "SqlClient.ts", "SqlClient"),
    ("@effect/sql-pg#PgClient.PgClient", "PG4", "PgClient.ts", "PgClient"),
    ("effect#FileSystem.FileSystem", "E4", "FileSystem.ts", "FileSystem"),
    ("effect#Path.Path", "E4", "Path.ts", "Path"),
    ("effect#Stdio.Stdio", "E4", "Stdio.ts", "Stdio"),
    ("effect#Terminal.Terminal", "E4", "Terminal.ts", "Terminal"),
    ("effect/process#ChildProcessSpawner.ChildProcessSpawner", "E4", "process/ChildProcessSpawner.ts", "ChildProcessSpawner"),
    ("effect/http#HttpClient.HttpClient", "E4", "http/HttpClient.ts", "HttpClient"),
]:
    SERVICES.append(dict(sym=sym, ver="3" if src == "S3" else "4", src=src, file=file, export=export, default=False))

# External layers and what they build (LY with file 4294967295). Each `builds` entry pairs the
# catalog service with the type name that must appear in the layer's declared type.
# Pack rules: the only entries that make findings (engine/ClassCtx.bend, relation RL).
# ctx bits (FACTS.md, CS): 2 = pack-defined effect context, 4 = inside a test.
# Each cite is the doc line that says the class does not belong in Effect code;
# the generator checks that the line holds `text`.
RULES = [
    dict(id="effect.ambient-read-in-effect", cls="ambient-read", ctx_any=2, ctx_none=4, ver=1,
         says="reads the clock, randomness or the environment directly inside Effect code, bypassing Clock, Random, Config or DateTime",
         src="ED", file="LLMS.md", line=290, text="use the `DateTime` module instead of `Date` and `Date.now`"),
    dict(id="effect.blocking-in-effect", cls="blocking", ctx_any=2, ctx_none=4, ver=1,
         says="makes a blocking host call inside Effect code instead of going through the FileSystem or ChildProcessSpawner service",
         src="E4", file="FileSystem.ts", line=4, text="`FileSystem` is the boundary between Effect code and the host file system."),
    dict(id="effect.runtime-escape-in-effect", cls="runtime-escape", ctx_any=2, ctx_none=4, ver=1,
         says="runs an effect to a Promise or a value from inside Effect code instead of composing it",
         src="ED", file="ai-docs/src/04_integration/10_managed-runtime.ts", line=4,
         text="Use `ManagedRuntime` to run Effect programs from external frameworks"),
]

LAYERS = [
    dict(sym="@effect/sql-pg#PgClient.layer", ver="4", src="PG4", file="PgClient.ts", export="layer",
         builds=[("@effect/sql-pg#PgClient.PgClient", "PgClient"), ("effect/sql#SqlClient.SqlClient", "Client.SqlClient")]),
    dict(sym="@effect/sql-pg#PgClient.layerConfig", ver="4", src="PG4", file="PgClient.ts", export="layerConfig",
         builds=[("@effect/sql-pg#PgClient.PgClient", "PgClient"), ("effect/sql#SqlClient.SqlClient", "Client.SqlClient")]),
]
for plat, mod, alias in [("platform-node", "NodeServices", "PN4"), ("platform-bun", "BunServices", "PB4")]:
    LAYERS.append(dict(sym=f"@effect/{plat}#{mod}.layer", ver="4", src=alias, file=f"{mod}.ts", export="layer",
                       type_alias=mod,
                       builds=[("effect/process#ChildProcessSpawner.ChildProcessSpawner", "ChildProcessSpawner"),
                               ("effect#FileSystem.FileSystem", "FileSystem"), ("effect#Path.Path", "Path"),
                               ("effect#Stdio.Stdio", "Stdio"), ("effect#Terminal.Terminal", "Terminal")]))


def layer_type_text(lay):
    """The declared type that names what the layer builds: the export's signature (up to `=>` / `=`),
    or the `export type <alias> =` line it refers to."""
    root, _ = SRC[lay["src"]]
    lines = lines_of(os.path.join(root, lay["file"]))
    if lay.get("type_alias"):
        d = next((i for i, l in enumerate(lines) if l.startswith(f"export type {lay['type_alias']} =")), None)
        return None if d is None else lines[d]
    d = find_decl(lines, lay["export"])
    if d is None:
        return None
    text = []
    for l in lines[d:d + 12]:
        text.append(l)
        if "=>" in l or l.rstrip().endswith("="):
            break
    return " ".join(text)


# ---------------------------------------------------------------------------
# Platform catalog (Node and the JS runtime). Not Effect-specific.
# ---------------------------------------------------------------------------
P = []
FS_SYNC = ["accessSync", "appendFileSync", "chmodSync", "chownSync", "closeSync", "copyFileSync", "cpSync",
           "existsSync", "fchmodSync", "fchownSync", "fdatasyncSync", "fstatSync", "fsyncSync", "ftruncateSync",
           "futimesSync", "globSync", "lchownSync", "linkSync", "lstatSync", "lutimesSync", "mkdirSync",
           "mkdtempSync", "openSync", "opendirSync", "readFileSync", "readSync", "readdirSync", "readlinkSync",
           "readvSync", "realpathSync", "renameSync", "rmSync", "rmdirSync", "statSync", "statfsSync",
           "symlinkSync", "truncateSync", "unlinkSync", "utimesSync", "writeFileSync", "writeSync", "writevSync"]
for n in FS_SYNC:
    P.append(dict(cls="blocking", sym=f"node:fs#{n}", ver="node", src="NODE", file="fs.d.ts", export=n, via="call", use=None, member_of=None))
for n in ["execSync", "execFileSync", "spawnSync"]:
    P.append(dict(cls="blocking", sym=f"node:child_process#{n}", ver="node", src="NODE", file="child_process.d.ts", export=n, via="call", use=None, member_of=None))
P.append(dict(cls="ambient-read", sym="global#process.env", ver="node", src="NODE", file="process.d.ts", export="env", via="read", use=None, member_of="Process"))

# ---------------------------------------------------------------------------
# JS globals: universal JavaScript runtime APIs (browser, edge, Node). Always-on TS-lane data,
# class data only: no finding fires from classification alone (lead ruling on #660).
# ---------------------------------------------------------------------------
J = []
J.append(dict(cls="ambient-read", sym="global#Date.now", ver="js", src="TS", file="lib.es5.d.ts", export="now", via="call", use=None, member_of="DateConstructor"))
J.append(dict(cls="ambient-read", sym="global#Date", ver="js", src="TS", file="lib.es5.d.ts", export="new", via="new", use="noargs", member_of="DateConstructor"))
J.append(dict(cls="ambient-read", sym="global#Math.random", ver="js", src="TS", file="lib.es5.d.ts", export="random", via="call", use=None, member_of="Math"))
J.append(dict(cls="ambient-read", sym="global#performance.now", ver="js", src="TS", file="lib.dom.d.ts", export="now", via="call", use=None, member_of="Performance"))
J.append(dict(cls="ambient-read", sym="global#crypto.randomUUID", ver="js", src="TS", file="lib.dom.d.ts", export="randomUUID", via="call", use=None, member_of="Crypto"))
for n in ["log", "error", "warn", "info", "debug", "trace"]:
    J.append(dict(cls="log", sym=f"global#console.{n}", ver="js", src="TS", file="lib.dom.d.ts", export=n, via="call", use=None, member_of="Console"))


WHY = {
    "error-erasing": r"defect|[Dd]iscard|remov|[Ii]gnor|fallback|none|replac|death|termination",
    "runtime-escape": r"Promise|[Ss]ynchronous|[Ee]xecut|[Rr]uns? |entrypoint",
    "fork": r"no parent|independent of its parent|not tied",
    "resource-acquire": r"clos|dispos|release|finaliz",
    "ambient-read": r"Date\.now|current|[Tt]ime|[Rr]andom|UUID|config|environment",
    "log": r"[Ll]og",
    "query": r"query|sql|SQL|repository",
    "blocking": r"[Ss]ynchronous|block",
}


def q(s):
    return '"' + s + '"'


def cite_fields(c):
    at, doc = c
    return [f"at = {q(at)}", f"doc = {q(doc)}"]


def entry_line(e, c):
    parts = [f"sym = {q(e['sym'])}", f"class = {q(e['cls'])}"]
    if e["via"] != "call":
        parts.append(f"via = {q(e['via'])}")
    if e.get("use"):
        parts.append(f"use = {q(e['use'])}")
    parts.append(f"ver = {q(e['ver'])}")
    parts += cite_fields(c)
    return "  { " + ", ".join(parts) + " },"


def is_effect_value(src, file, name, member_of):
    """True when the export is an Effect value (`export const x: Effect<...>`), not a function."""
    root, _ = SRC[src]
    lines = lines_of(os.path.join(root, file))
    d = find_decl(lines, name, member_of)
    return d is not None and re.match(rf"^export const {re.escape(name)}: (Effect\.)?Effect<", lines[d]) is not None


def render_symbols(entries):
    out = []
    for e in entries:
        if e["via"] == "call" and is_effect_value(e["src"], e["file"], e["export"], e.get("member_of")):
            # An Effect value is used by reference (`yield* Clock.currentTimeMillis`), never called.
            e = dict(e, via="ref")
        c = cite(e["src"], e["file"], e["export"], e.get("member_of"), WHY[e["cls"]])
        if c:
            out.append((e["sym"], e["via"], e.get("use") or "", e["ver"], entry_line(e, c)))
    seen, lines = set(), []
    for k in sorted(out):
        if k[:4] not in seen:
            seen.add(k[:4])
            lines.append(k[4])
    return lines


CLASSES = [("query", 1), ("blocking", 2), ("log", 3), ("error-erasing", 4), ("runtime-escape", 5),
           ("fork", 6), ("resource-acquire", 7), ("ambient-read", 8)]


def header(cid, desc, activate, sources, aliases, scope="pack"):
    h = [f"# {desc}", "# Generated by gen_catalog.py. at/doc: the JSDoc line of the export that justifies the class (\"signature:\" when the export has no prose doc).",
         "# One entry per line, sorted by (sym, via, use, ver). Edit the generator, not this file.",
         'format = "pulsar-catalog 0"', f'id = "{cid}"', f'scope = "{scope}"'] + (
         ["activate = [" + ", ".join(q(a) for a in activate) + "]"] if activate else []) + [
         "sources = [" + ", ".join(q(s) for s in sources) + "]", ""]
    h.append("# Module aliases: importing P/X directly is the namespace X of barrel P. Longest prefix wins.")
    h.append("aliases = [")
    for a, b in aliases:
        h.append(f"  {{ from = {q(a)}, to = {q(b)} }},")
    h.append("]")
    h.append("")
    h.append("# Fixed class ids from FACTS.md; the rule id is reported with every finding that uses the class.")
    h.append("classes = [")
    for n, i in CLASSES:
        h.append(f"  {{ class = {q(n)}, id = {i}, rule = {q(cid + '/' + n)} }},")
    h.append("]")
    h.append("")
    return h


def main(out_dir, check=False):
    os.makedirs(out_dir, exist_ok=True)
    eff = header(
        "effect", "Effect pack catalog: effect (v3 and v4) and @effect/sql, @effect/sql-pg, @effect/platform-*.",
        ["dep:effect", "dep:@effect/sql", "dep:@effect/sql-pg"],
        ["effect@9428e17499 (v4, ~/playground/effect)", "effect@3.21.0", "@effect/sql@0.51.1", "@types/node@25.6.0"],
        [("@effect/platform-browser/", "@effect/platform-browser#"), ("@effect/platform-bun/", "@effect/platform-bun#"),
         ("@effect/platform-deno/", "@effect/platform-deno#"), ("@effect/platform-node/", "@effect/platform-node#"),
         ("@effect/sql-pg/", "@effect/sql-pg#"), ("@effect/sql/", "@effect/sql#"),
         ("effect/sql/", "effect/sql#"), ("effect/", "effect#")])
    eff.append("symbols = [")
    eff += render_symbols(E)
    eff.append("]")
    eff.append("")
    eff.append("# Error handlers, for HD facts. arg: last-fn = the last function-valued argument;")
    eff.append("# object-fns = each function-valued property of the object argument.")
    eff.append("handlers = [")
    hl = []
    for h in HANDLERS:
        c = cite(h["src"], h["file"], h["export"])
        if c:
            hl.append((h["sym"], h["ver"], f"  {{ sym = {q(h['sym'])}, arg = {q(h['arg'])}, ver = {q(h['ver'])}, {", ".join(cite_fields(c))} }},"))
    eff += [x[2] for x in sorted(hl)]
    eff.append("]")
    eff.append("")
    eff.append("# Wrappers: function-valued arguments run inside an Effect generator (CS ctx bit 2).")
    eff.append("# Also matched when the call's callee is itself a call of sym (curried Effect.fn(\"n\")(body)).")
    eff.append("# label = first-string: the first string argument is a display label in .fns, never part of FK.")
    eff.append("wrappers = [")
    wl = []
    for w in WRAPPERS:
        c = cite(w["src"], w["file"], w["export"])
        if c:
            wl.append((w["sym"], w["ver"], f"  {{ sym = {q(w['sym'])}, ctx = 2, label = {q(w['label'])}, ver = {q(w['ver'])}, {", ".join(cite_fields(c))} }},"))
    eff += [x[2] for x in sorted(wl)]
    eff.append("]")
    eff.append("")
    eff.append("# External services (SV with file 4294967295). default = true: always provided (SV kind 1).")
    eff.append("services = [")
    sl = []
    for s in SERVICES:
        if s.get("why_file"):
            c = cite(s["src"], s["why_file"], s["why_export"], None, s["why"])
            if c and not re.search(s["why"], c[1]):
                # the justification lives in the signature, not the JSDoc: cite the matching line
                root, prefix = SRC[s["src"]]
                lines = lines_of(os.path.join(root, s["why_file"]))
                d = find_decl(lines, s["why_export"])
                hit = next((i for i in range(d, d + 40) if re.search(s["why"], lines[i])), None)
                c = (f"{prefix}{s['why_file']}:{hit + 1}", "signature: " + lines[hit].strip()) if hit is not None else None
                if c is None:
                    ERRORS.append(f"no justification {s['sym']}")
            if cite(s["src"], s["file"], s["export"]) is None:
                c = None
        else:
            c = cite(s["src"], s["file"], s["export"])
        if c:
            dflt = "true" if s["default"] else "false"
            sl.append((s["sym"], s["ver"], f"  {{ sym = {q(s['sym'])}, default = {dflt}, ver = {q(s['ver'])}, {", ".join(cite_fields(c))} }},"))
    eff += [x[2] for x in sorted(sl)]
    eff.append("]")
    eff.append("")
    eff.append("# External layers and the services they build (LY with file 4294967295). Every name in")
    eff.append("# builds was checked against the layer's declared type. A layer not listed here is LO (opaque).")
    eff.append("layers = [")
    known = {x["sym"] for x in SERVICES}
    ll = []
    for lay in LAYERS:
        c = cite(lay["src"], lay["file"], lay["export"])
        t = layer_type_text(lay)
        if t is None:
            ERRORS.append(f"no declared type {lay['sym']}")
            continue
        for svc, tok in lay["builds"]:
            if not re.search(rf"(?<![A-Za-z.]){re.escape(tok)}\b", t):
                ERRORS.append(f"{lay['sym']}: {tok} not in declared type")
            if svc not in known:
                ERRORS.append(f"{lay['sym']}: {svc} not in services")
        if c:
            b = ", ".join(q(x[0]) for x in sorted(lay["builds"]))
            ll.append((lay["sym"], f"  {{ sym = {q(lay['sym'])}, builds = [{b}], ver = {q(lay['ver'])}, {", ".join(cite_fields(c))} }},"))
    eff += [x[1] for x in sorted(ll)]
    eff.append("]")
    eff.append("")
    eff.append("# Rules: a finding needs an active rule (RL). A call of the class in a context with some bit")
    eff.append("# of ctx_any and no bit of ctx_none is a finding. ctx 2 = pack-defined effect context, 4 = test.")
    eff.append("rules = [")
    classes = {e["cls"] for e in E + P + J}
    for r in sorted(RULES, key=lambda r: r["id"]):
        root, prefix = SRC[r["src"]]
        ln = lines_of(f"{root}/{r['file']}")
        got = ln[r["line"] - 1] if r["line"] <= len(ln) else ""
        if r["text"] not in got:
            ERRORS.append(f"rule {r['id']}: {r['file']}:{r['line']} does not hold the cited text")
            continue
        if r["cls"] not in classes:
            ERRORS.append(f"rule {r['id']}: class {r['cls']} has no entry")
        doc = re.sub(r"^\s*(//|\*|#)?\s*", "", got).strip().replace("\\", "\\\\").replace('"', '\\"')
        eff.append(f"  {{ id = {q(r['id'])}, class = {q(r['cls'])}, ctx_any = {r['ctx_any']}, ctx_none = {r['ctx_none']}, "
                   f"says = {q(r['says'])}, ver = \"{r['ver']}\", at = {q(prefix + r['file'] + ':' + str(r['line']))}, doc = {q(doc)} }},")
    eff.append("]")

    plat = header(
        "platform-node", "Platform pack catalog: Node.js-only runtime APIs. Library data, not a core default.",
        ["dep:@types/node", "import:node:*"],
        ["@types/node@25.6.0"],
        [("fs/", "node:fs/"), ("fs", "node:fs"), ("child_process", "node:child_process")])
    plat.append("symbols = [")
    plat += render_symbols(P)
    plat.append("]")

    js = header(
        "js-globals", "TS-lane catalog: universal JavaScript runtime globals. Always on; class data only, never a finding by itself.",
        [], ["typescript@5.9.3 lib"], [], scope="lane")
    js.append("symbols = [")
    js += render_symbols(J)
    js.append("]")

    if ERRORS:
        for e in ERRORS:
            print("ERROR", e, file=sys.stderr)
        sys.exit(1)
    print(f"signature-only cites: {len(NODOC)}", *NODOC, sep="\n  ", file=sys.stderr)
    outputs = {"effect.toml": "\n".join(eff) + "\n", "platform-node.toml": "\n".join(plat) + "\n",
               "js-globals.toml": "\n".join(js) + "\n"}
    if check:
        stale = [n for n, text in outputs.items()
                 if not os.path.exists(os.path.join(out_dir, n)) or open(os.path.join(out_dir, n)).read() != text]
        for n in stale:
            print(f"STALE {n}: regenerate with gen_catalog.py {out_dir}", file=sys.stderr)
        sys.exit(1 if stale else 0)
    for n, text in outputs.items():
        with open(os.path.join(out_dir, n), "w") as f:
            f.write(text)


if __name__ == "__main__":
    args = sys.argv[1:]
    check = "--check" in args
    args = [a for a in args if a != "--check"]
    main(args[0] if args else os.path.dirname(os.path.abspath(__file__)), check)
