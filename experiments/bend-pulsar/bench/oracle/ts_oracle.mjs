#!/usr/bin/env node
// TypeScript function oracle: inventory + ESLint complexity rules.
//
// Emits one JSONL row per function per corpus file:
//
//   {"tool":"ts-inventory","path":...,"name":...,"kind":...,"chain":...,
//    "child_ordinal":N,"name_ordinal":N,"start_line":N,"start_col":N,
//    "end_line":N,"end_col":N,"metrics":{"eslint.cyclomatic":N,
//    "eslint.cognitive":N}}
//
// Identity fields mirror the .fns side-table contract (FACTS.md): path,
// container chain (outermost first, joined by ">", ending with the
// function itself), name, kind, ordinal — never line numbers as identity
// (lines are kept for joining oracle tools that only report positions).
//
// ESLint rule reports land on different anchors depending on node kind
// (`function` keyword, method key, `=>` token, function name), so metrics
// are joined by containment: a report position maps to the innermost
// function whose join-span contains it. join_span is the function node
// itself, or its Property/MethodDefinition wrapper for methods and
// object-literal properties (whose report loc covers the key).
//
// Usage:
//   node ts_oracle.mjs --repo <dir> [--files <listfile>] [-o out.jsonl]
//                      [--no-eslint]
//
// File selection matches `pulsar facts`: `git -C <repo> ls-files` filtered
// to .ts/.tsx/.mts/.cts minus .d.* — unless --files supplies an explicit
// newline-separated repo-relative list.

import { ESLint } from "eslint";
import tsParser from "@typescript-eslint/parser";
import sonarjs from "eslint-plugin-sonarjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

// Nodes whose key/value can name a container for descendant chains
// (object literals, classes, namespaces).
const CLASS_CONTAINER = new Set(["ClassDeclaration", "ClassExpression"]);
const PROPERTY_WRAPPER = new Set([
  "MethodDefinition",
  "Property",
  "PropertyDefinition",
  "AccessorProperty",
  "TSAbstractMethodDefinition",
  "TSAbstractPropertyDefinition",
]);

function isTsSource(p) {
  return (
    (p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".mts") || p.endsWith(".cts")) &&
    !p.endsWith(".d.ts") &&
    !p.endsWith(".d.mts") &&
    !p.endsWith(".d.cts")
  );
}

function gitFiles(repo) {
  const out = execFileSync("git", ["-C", repo, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 });
  return out.split("\n").filter((p) => p && isTsSource(p));
}

function keyName(key) {
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") return String(key.value);
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  return null;
}

// Resolve the name a function node carries, from itself or its syntactic
// parent (variable declarator, property/method key, assignment target).
function nodeName(node, parent) {
  if (node.id && node.id.type === "Identifier") return node.id.name;
  if (!parent) return null;
  switch (parent.type) {
    case "VariableDeclarator":
      return parent.id.type === "Identifier" ? parent.id.name : null;
    case "Property":
    case "PropertyDefinition":
    case "MethodDefinition":
    case "AccessorProperty":
    case "TSAbstractMethodDefinition":
    case "TSAbstractPropertyDefinition":
      return keyName(parent.key);
    case "AssignmentExpression":
      return parent.left.type === "Identifier" ? parent.left.name : keyName(parent.left);
    case "ExportDefaultDeclaration":
      return "default";
    default:
      return null;
  }
}

function kindOf(node, parent) {
  if (node.type === "FunctionDeclaration") return "function";
  if (node.type === "ArrowFunctionExpression") {
    if (parent && PROPERTY_WRAPPER.has(parent.type)) {
      if (parent.kind === "get") return "getter";
      if (parent.kind === "set") return "setter";
      if (parent.kind === "method" || parent.type === "MethodDefinition" ||
          parent.type === "TSAbstractMethodDefinition") return "method";
    }
    return "arrow";
  }
  if (parent && PROPERTY_WRAPPER.has(parent.type)) {
    if (parent.kind === "get") return "getter";
    if (parent.kind === "set") return "setter";
    if (parent.kind === "constructor" || keyName(parent.key) === "constructor") return "constructor";
    return "method";
  }
  return "function-expression";
}

// The span ESLint reports against: the function node itself, or the
// property/method wrapper whose key the rule anchors to.
function joinNode(node, parent) {
  if (node.type !== "FunctionDeclaration" && parent && PROPERTY_WRAPPER.has(parent.type)) {
    return parent;
  }
  return node;
}

// Name a non-function node contributes to descendant chains, if any.
function chainContribution(node) {
  switch (node.type) {
    case "ClassDeclaration":
    case "ClassExpression":
      return node.id && node.id.type === "Identifier" ? node.id.name : null;
    case "TSModuleDeclaration":
      return node.id && node.id.type === "Identifier" ? node.id.name : null;
    case "VariableDeclarator":
      // `const obj = { m() {} }` — the object names its methods' chain.
      // Function-valued inits name themselves via nodeName instead.
      if (node.id && node.id.type === "Identifier" &&
          node.init && (node.init.type === "ObjectExpression" || node.init.type === "ClassExpression")) {
        return node.id.name;
      }
      return null;
    case "Property":
      if (node.value && (node.value.type === "ObjectExpression" || node.value.type === "ClassExpression")) {
        return keyName(node.key);
      }
      return null;
    default:
      return null;
  }
}

// Walk the AST tracking the chain of named containers. Returns rows with
// identity fields plus a `join` span (line/col) used to attach ESLint
// metrics by containment.
function inventory(file, ast) {
  const rows = [];
  const childCount = new Map(); // parent node -> function children seen
  const nameCount = new Map();  // "chain|kind|name" -> same-name functions seen

  function visit(node, chain, parent) {
    if (!node || typeof node.type !== "string") return;

    if (FUNCTION_TYPES.has(node.type)) {
      const name = nodeName(node, parent);
      const kind = kindOf(node, parent);
      const childOrd = parent ? (childCount.get(parent) ?? 0) : 0;
      if (parent) childCount.set(parent, childOrd + 1);
      const selfChain = name ?? `<anon:${childOrd}>`;
      const chainStr = [...chain, selfChain].join(">");
      const nameKey = `${chainStr}|${kind}|${name ?? ""}`;
      const nameOrd = name == null ? 0 : (nameCount.get(nameKey) ?? 0);
      if (name != null) nameCount.set(nameKey, nameOrd + 1);

      const jn = joinNode(node, parent);
      rows.push({
        tool: "ts-inventory",
        path: file,
        name,
        kind,
        chain: chainStr,
        child_ordinal: childOrd,
        name_ordinal: nameOrd,
        start_line: node.loc.start.line,
        start_col: node.loc.start.column,
        end_line: node.loc.end.line,
        end_col: node.loc.end.column,
        join_start_line: jn.loc.start.line,
        join_start_col: jn.loc.start.column,
        join_end_line: jn.loc.end.line,
        join_end_col: jn.loc.end.column,
      });
      visitChildren(node, [...chain, selfChain], node);
      return;
    }

    const contrib = chainContribution(node);
    const nextChain = contrib ? [...chain, contrib] : chain;
    visitChildren(node, nextChain, node);
  }

  function visitChildren(node, chain, parentForChildren) {
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const v = node[key];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === "string") visit(c, chain, parentForChildren);
      } else if (v && typeof v.type === "string") {
        visit(v, chain, parentForChildren);
      }
    }
  }

  visit(ast, [], null);
  return rows;
}

// Point-in-span test. `col` is 0-based (ESLint's 1-based column minus 1);
// join cols are ESTree 0-based with end exclusive.
function contains(row, line, col) {
  const afterStart =
    line > row.join_start_line ||
    (line === row.join_start_line && col >= row.join_start_col);
  const beforeEnd =
    line < row.join_end_line ||
    (line === row.join_end_line && col < row.join_end_col);
  return afterStart && beforeEnd;
}

function makeEslint(repo) {
  return new ESLint({
    cwd: repo,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
        languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
        plugins: { sonarjs },
        rules: {
          complexity: ["error", { max: 0 }],
          "sonarjs/cognitive-complexity": ["error", 0],
        },
      },
    ],
  });
}

async function eslintMetrics(eslint, absFiles) {
  const results = await eslint.lintFiles(absFiles);
  // file -> list of {line, col, ruleId, value}
  const byFile = new Map();
  for (const res of results) {
    const rel = res.filePath;
    for (const m of res.messages) {
      if (m.ruleId !== "complexity" && m.ruleId !== "sonarjs/cognitive-complexity") continue;
      const metric = m.ruleId === "complexity" ? "eslint.cyclomatic" : "eslint.cognitive";
      const num = /complexity of (\d+)/.exec(m.message)?.[1] ?? /(\d+) to the/.exec(m.message)?.[1];
      if (num == null) continue;
      const list = byFile.get(rel) ?? [];
      list.push({ line: m.line, col: m.column, metric, value: parseInt(num, 10), text: m.message });
      byFile.set(rel, list);
    }
  }
  return byFile;
}

function parseArgs(argv) {
  const o = { repo: null, files: null, out: null, eslint: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") o.repo = argv[++i];
    else if (a === "--files") o.files = argv[++i];
    else if (a === "--out" || a === "-o") o.out = argv[++i];
    else if (a === "--no-eslint") o.eslint = false;
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  if (!o.repo) { console.error("--repo required"); process.exit(2); }
  return o;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const repo = resolve(opt.repo);
  const relFiles = opt.files
    ? readFileSync(opt.files, "utf8").split("\n").filter(Boolean)
    : gitFiles(repo);

  // Parse, inventory and lint in chunks so ASTs do not accumulate: large
  // corpora (junto ~2k TS files) exhaust the default heap otherwise.
  const CHUNK = 200;
  const eslint = opt.eslint ? makeEslint(repo) : null;
  let attached = 0, missed = 0;
  const outLines = [];

  for (let i = 0; i < relFiles.length; i += CHUNK) {
    const slice = relFiles.slice(i, i + CHUNK);
    const parsed = [];
    for (const rel of slice) {
      const abs = join(repo, rel);
      let code;
      try { code = readFileSync(abs, "utf8"); } catch { continue; }
      let ast;
      try {
        ast = tsParser.parse(code, {
          loc: true, range: true, tokens: false, comment: false,
          sourceType: "module",
        });
      } catch {
        continue; // unparseable file: oracle skips, diff reports coverage gap
      }
      parsed.push({ rel, abs, ast });
    }

    const allRows = [];
    const rowsByFile = new Map();
    for (const { rel, ast } of parsed) {
      const rows = inventory(rel, ast);
      rowsByFile.set(join(repo, rel), rows);
      allRows.push(...rows);
    }

    if (eslint) {
      const byFile = await eslintMetrics(eslint, parsed.map((p) => p.abs));
      for (const [abs, msgs] of byFile) {
        const rows = rowsByFile.get(abs) ?? [];
        for (const m of msgs) {
          // Innermost join-span containing the report position.
          let best = null, bestSize = Infinity;
          for (const r of rows) {
            if (!contains(r, m.line, m.col - 1)) continue;
            const size = (r.join_end_line - r.join_start_line) * 100000 +
                         (r.join_end_col - r.join_start_col);
            if (size < bestSize) { bestSize = size; best = r; }
          }
          if (best) {
            best.metrics = best.metrics ?? {};
            best.metrics[m.metric] = m.value;
            attached++;
          } else {
            missed++;
            if (process.env.ORACLE_DEBUG_MISSES) {
              console.error(`miss ${m.metric} ${abs}:${m.line}:${m.col} "${(m.text ?? "").slice(0, 60)}"`);
            }
          }
        }
      }
    }

    for (const r of allRows) outLines.push(JSON.stringify(r));
  }

  if (opt.eslint) {
    console.error(`ts_oracle: eslint messages attached=${attached} missed=${missed}`);
  }
  const text = outLines.join("\n") + "\n";
  if (opt.out) writeFileSync(opt.out, text);
  else process.stdout.write(text);
  console.error(`ts_oracle: ${relFiles.length} files, ${outLines.length} functions`);
}

main().catch((e) => { console.error(e); process.exit(1); });
