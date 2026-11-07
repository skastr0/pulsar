#!/usr/bin/env python3
"""API drift: which symbols a catalog names are missing from another version of their package.

    python3 -I tools/catalog-drift.py <catalog.toml> --ver <label> --pkg <name>=<dir> [--pkg ...]

For each symbol `<module>#<A>.<b>` whose `ver` is <label>, the catalog's own `aliases`
(`{ from = "P/", to = "M#" }`: importing P/A is namespace A of M) give the import
specifiers that name it. The first one that resolves through the package's
package.json `exports` (exact key, or a `./*` pattern; `types` before the JS target,
a `.d.ts` beside a `.js`, and `src/<x>.ts` when the package ships sources instead of
a build) is the module, and <b> must be one of its exports. Exports are read
syntactically: `export const|function|class|interface|type|namespace|enum NAME`,
`export { .. NAME .. }` (`x as NAME` too), `export * as NAME`, and `export * from "./rel"`
followed inside the package, all after comments are removed.

The tool is generic: it knows no library. The names come from the catalog and the
version from the package directory given. Output: one line per symbol that is not
found, a count per status, and exit 1 when anything is missing.
"""
import json
import os
import re
import sys
import tomllib


def load_catalog(path):
    with open(path, "rb") as f:
        return tomllib.load(f)


def resolve_export_target(pkg_dir, sub):
    """The file a specifier subpath ("." or "./A/B") names, per package.json exports."""
    with open(os.path.join(pkg_dir, "package.json")) as f:
        exports = json.load(f).get("exports")
    if not isinstance(exports, dict):
        return None
    target = exports.get(sub)
    if target is None:
        for key, val in exports.items():
            if key.count("*") == 1:
                pre, post = key.split("*")
                if sub.startswith(pre) and sub.endswith(post) and len(sub) >= len(pre) + len(post):
                    star = sub[len(pre):len(sub) - len(post)]
                    target = json.loads(json.dumps(val).replace("*", star))
                    break
    while isinstance(target, dict):
        target = target.get("types") or target.get("import") or target.get("default")
    if not isinstance(target, str):
        return None
    for cand in candidates(pkg_dir, target):
        if os.path.isfile(cand):
            return cand
    return None


def candidates(pkg_dir, target):
    rel = target[2:] if target.startswith("./") else target
    base = re.sub(r"\.(d\.ts|js|mjs|cjs|ts)$", "", rel)
    out = [os.path.join(pkg_dir, rel), os.path.join(pkg_dir, base + ".d.ts")]
    if base.startswith("dist/"):
        out += [os.path.join(pkg_dir, "src", base[5:] + ".ts"), os.path.join(pkg_dir, "src", base[5:], "index.ts")]
    return out


EXPORT_DECL = re.compile(
    r"^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function\*?|class|interface|type|namespace|enum)\s+([A-Za-z_$][\w$]*)",
    re.M)
EXPORT_LIST = re.compile(r"^\s*export\s+(?:type\s+)?\{([^}]*)\}", re.M)
EXPORT_STAR_AS = re.compile(r"^\s*export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from", re.M)
EXPORT_STAR = re.compile(r"^\s*export\s+\*\s+from\s+[\"']([^\"']+)[\"']", re.M)


def exports_of(path, seen=None):
    seen = seen if seen is not None else set()
    if path in seen or not os.path.isfile(path):
        return set()
    seen.add(path)
    src = open(path, encoding="utf-8", errors="replace").read()
    # Comments first: JSDoc inside an `export { .. }` list carries braces from its examples.
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"(?m)(?<![:\w\"'])//.*$", "", src)
    names = set(EXPORT_DECL.findall(src)) | set(EXPORT_STAR_AS.findall(src))
    for body in EXPORT_LIST.findall(src):
        for part in body.split(","):
            part = re.sub(r"^\s*type\s+", "", part.strip())
            if part:
                names.add(part.split(" as ")[-1].strip())
    for rel in EXPORT_STAR.findall(src):
        if rel.startswith("."):
            here = os.path.dirname(path)
            b = re.sub(r"\.(d\.ts|js|ts)$", "", rel)
            for c in (b + ".d.ts", b + ".ts", os.path.join(b, "index.d.ts"), os.path.join(b, "index.ts")):
                names |= exports_of(os.path.normpath(os.path.join(here, c)), seen)
    return names


def split_spec(spec, pkgs):
    """('effect/unstable/sql/SqlClient', {...}) -> (dir of 'effect', './unstable/sql/SqlClient')."""
    for name in sorted(pkgs, key=len, reverse=True):
        if spec == name:
            return pkgs[name], "."
        if spec.startswith(name + "/"):
            return pkgs[name], "./" + spec[len(name) + 1:]
    return None, None


def main(argv):
    if len(argv) < 2 or "--ver" not in argv:
        print(__doc__.strip().split("\n\n")[1], file=sys.stderr)
        return 2
    cat = load_catalog(argv[1])
    ver = argv[argv.index("--ver") + 1]
    pkgs = {}
    for i, a in enumerate(argv):
        if a == "--pkg":
            name, d = argv[i + 1].split("=", 1)
            pkgs[name] = os.path.expanduser(d)
    aliases = [(a["from"], a["to"]) for a in cat.get("aliases", [])]
    syms = set()
    for table in ("symbols", "handlers", "entries", "wrappers", "services", "layers"):
        for e in cat.get(table, []):
            if e.get("ver") == ver and "#" in e.get("sym", ""):
                syms.add(e["sym"])
    status = {}
    cache = {}
    for sym in sorted(syms):
        module, path = sym.split("#", 1)
        parts = path.split(".")
        if not parts[0]:
            status[sym] = ("skip", "default export")
            continue
        specs = [frm + parts[0] for frm, to in aliases if to == module + "#"]
        if len(parts) == 1:
            specs = [module]
        hit = None
        for spec in specs:
            d, sub = split_spec(spec.rstrip("/"), pkgs)
            if d is None:
                continue
            f = resolve_export_target(d, sub)
            if f:
                hit = (spec, f)
                break
        if not hit:
            known = any(split_spec(s, pkgs)[0] for s in specs) or split_spec(module, pkgs)[0]
            status[sym] = ("no-module" if known else "skip", "tried " + ", ".join(specs or [module]))
            continue
        name = parts[1] if len(parts) > 1 else parts[0]
        if hit[1] not in cache:
            cache[hit[1]] = exports_of(hit[1])
        if name in cache[hit[1]]:
            status[sym] = ("ok", hit[0])
        else:
            status[sym] = ("missing", f"{name} not exported by {hit[0]}")
    counts = {}
    for sym, (st, why) in status.items():
        counts[st] = counts.get(st, 0) + 1
        if st in ("missing", "no-module"):
            print(f"{st:9} {sym}  ({why})")
    print("# " + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    return 1 if counts.get("missing") or counts.get("no-module") else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
