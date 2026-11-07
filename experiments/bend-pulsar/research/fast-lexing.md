# Fast lexing for the Bend import scanner: ranked techniques

Everything below was read from papers, docs and blog text. Nothing was run in Bend. **(est.)** marks my estimates. No lexer or parser source was read.

## Premise corrections

- **Arrays are flat at runtime.** The BendRT paper (`bend2/docs/BendRT/main.typ`, section Arrays; also https://bend2.dev/notes/bendrt-explained) says `Array<T>` is a tree only in the source. The backends run it as one flat block of packed 32-bit cells with O(1) load and store. Matching an array into `ANode` halves copies them, O(n log n) over a full walk, so never recurse by matching. `Array.fork`/`Array.join` (`@unsafe`) give two handles to one block in O(1). A shared read-only buffer is therefore possible. "No flat buffer" holds only for `List` and `String`.
- **No work stealing.** Each task is assigned once, and skewed forks silently lose parallelism (paper, Limitations; guide, Parallelism). `main.bend` splits the file list by count (`lvl0..lvl12`), and file sizes are skewed. Skew is my first suspect for 1.6 of 10 cores. **Unverified.**
- **Effects share one host event loop** (guide). Serial reads and the `List<U32>` to `String` conversion may be a large part of 5.6 s. Time read, convert, lex and graph separately first.
- **Targets.** BendRT sequential code runs at 0.8 to 1.5x the time of its C twin, and balanced forks give 8.8 to 12.1x on 16 threads (paper, results). es-module-lexer (Wasm, one thread) takes 3.2 to 4.7 ms/MB, about 100 to 150 ms for 33 MB (https://github.com/guybedford/es-module-lexer). A realistic Bend goal is 0.3 to 0.6 s **(est.)**. oxc's 27 ms is out of reach.

## Ranked techniques

### 1. Balance forks by bytes; profile phases
- **What:** Fork by cumulative file size, not file count. Use `File.size` and recursive halving by bytes.
- **Source:** BendRT paper ("Why Nothing Contends", Limitations).
- **Gain:** Up to 3 to 6x if skew is the cause **(est.)**.
- **Fit:** Native.
- **Risk:** Low.

### 2. Packed 4-bytes-per-U32 text in a flat `Array<U32>`
- **What:** Convert each file once to packed words. Keep them in an array indexed with `Array.get`, or in a list with 4x fewer nodes. Chunked lists (`List<Array<U32>>`) are ropes with big leaves (Boehm, Atkinson and Plass, https://www.cs.tufts.edu/~nr/cs257/archive/hans-boehm/ropes.pdf).
- **Evidence:** Fast functional text libraries all wrap a flat packed byte array: Haskell `bytestring`, and `text` 2.0 on UTF-8 (https://hackage.haskell.org/package/text-2.0/changelog). SWAR over a Haskell `ByteArray` gave about 7x on a 64-bit first-match search (https://www.mlabs.city/blog/fast-findings). Finger trees help splitting and concatenation, not scanning, so skip them.
- **Gain:** 2 to 4x on scan-dominated code **(est.)**.
- **Fit:** Good. `Array.get` returns the array and the element, so thread the array through loops. Per-task handles come from `Array.fork`.
- **Risk:** Medium. The list-to-array conversion is sequential, so check the cost of `File.read_bytes` first.

### 3. SWAR skip loops on 32-bit words
- **What:** Skip identifiers, whitespace, comment text, string bodies and template text a word at a time. Per needle byte `c`, test `((x ^ c*0x01010101) - 0x01010101) & ~x & 0x80808080`. For a range test, use `(x - 0x20202020) & ~x & 0x80808080` (https://lemire.me/blog/2025/04/13/detect-control-characters-quotes-and-backslashes-efficiently-using-swar, https://graphics.stanford.edu/~seander/bithacks.html). OR the masks for `"`, `'`, `` ` ``, `\`, `/`, `*`, `\n`, `{`, `}`, `$`. On a hit, step byte by byte, because bytes above the first match can be false positives.
- **Measured elsewhere:**
  - ASCII check on 64-bit words: 2.0 to 3.5 GB/s (https://lemire.me/blog/2020/07/21/avoid-character-by-character-processing-when-performance-matters).
  - Escape check: simple loop 0.65 GB/s, branchless 0.91, table 1.9, SIMD 5.2 (https://lemire.me/blog/2024/05/31/quickly-checking-whether-a-string-needs-escaping).
  - Haskell first-match search: about 7x (mlabs, above).
- **Gain:** 32-bit words cap this at 4x per skipped byte. Expect 1.5 to 2.5x overall **(est.)**.
- **Fit:** Good. It uses only `U32` and/or/xor/sub/shift from Base.
- **Risk:** Low to medium.

### 4. Character classes as register bitmaps
- **What:** For ASCII `c`, class bit = `(MASK[c>>5] >> (c&31)) & 1`, with four `U32` constants per class. Non-ASCII bytes go to one class. No table loads.
- **Source:** My idea, motivated by the table versus branchless comparison in the Lemire 2024 post.
- **Gain:** 1.2 to 1.5x on the non-skipped path **(est.)**.
- **Fit:** Excellent.
- **Risk:** Low.

### 5. Context-enumerative chunk parallelism for big files
- **What:** Cut a big file into equal chunks. Lex each chunk once per possible starting context (code, block comment, template, regex). Each chunk's summary is (end context and specifiers found, per start context). Joining is associative: the left chunk's end context picks the right chunk's summary. That is a balanced fork/join tree.
- **Sources:**
  - Mytkowicz, Musuvathi and Schulte, ASPLOS 2014 (https://microsoft.com/en-us/research/wp-content/uploads/2016/02/asplos302-mytkowicz.pdf): enumerate all start states and prune by convergence. Up to 3x on one core and 21x on 8 cores, on regex, Huffman and HTML tokenizing.
  - ParPaRaw (https://arxiv.org/abs/1905.13415): quote-context state vectors, no sequential pre-pass, 14.2 GB/s on a GPU.
  - Ogden et al., parallel pushdown transducers, VLDB 2014 (https://vldb.org/pvldb/vol6/p1738-ogden.pdf): chunk summaries carry unmatched openers and closers, resolved at the join. This is the published answer for non-regular nesting.
  - arXiv:2412.14975 on speculation overhead, and arXiv:2608.03473 on certified split points. Cutting at a byte that provably starts a token needs no speculation (3.46 to 3.94x on 4 threads, 92.6 to 95.3% efficiency at 8). It refuses newline where block comments are unrestricted, which is JS.
- **Do not** use a per-byte transition-function scan with a k-by-k merge table (Pareas, Voetter 2021). Adding a string rule took k from 1,927 to 7,952 (126 MB), and a block comment rule passed 38,000 (over 2.8 GB) (https://ai.thesatyajit.com/articles/lexing-on-the-gpu). Enumerate only a handful of context states.
- **My inference, not sourced:**
  - Raw newlines end `'` and `"` strings, line comments and regexes in valid JS, so after a newline about 3 or 4 start contexts stay live.
  - Templates need a brace stack in the summary: `}` pops, `${` pushes.
  - A `/` whose decision depends on an earlier chunk is settled at the join, or both branches are kept.
- **Gain:** About 3 to 4x work per chunk, so it pays only for files above roughly 64 KB **(est.)**. The average file is 8.8 KB, so this helps the tail, not the mean.
- **Fit:** Good. Summaries are small affine tuples.
- **Risk:** High. Do it last.

### 6. Regex versus division, templates and import extraction
- **Keep:** the previous-significant-token rule, plus a bracket stack recording the token before each open `(` and `{`. `)` and `}` need this: `if (x) /re/` is a regex, `(a) / b` is division, and block `}` differs from object-literal `}`.
- **Sources:**
  - es-module-lexer README: "backtracking checks against punctuator prefixes, including closing brace or paren backtracking". Valid JS is always parsed correctly, invalid JS may be accepted, and nesting is capped at 1024.
  - js-tokens README (https://github.com/lydell/js-tokens): previous-token rule. It documents failures such as `case x: {}/a/g` and labelled statements, and says they cannot be told apart without a parser.
  - esbuild `docs/architecture.md`: the lexer is called on demand by the parser, since regex versus division and JSX depend on syntax. Exact but sequential.
  - Disney, Sweet.js reader: look back a few tokens through delimiter trees (https://disnetdev.com/blog/2012-12-20-how-to-read-macros).
  - ES spec goal symbols `InputElementDiv`, `InputElementRegExp`, `InputElementTemplateTail` (https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html).
- **Accuracy:** No published error rates. The documented trade-off is that only pathological or invalid input goes wrong. I found no algorithm-level description of the Vite or Rollup scanners (Vite uses esbuild, Rollup uses a full parser), so I report nothing about them.
- **Fit:** Close to the current `Lex.bend`. Move the stack to bit flags.
- **Risk:** Low.

### 7. Graph phase (low priority)
- **What:** Peel zero-in and zero-out nodes first (Hong et al., SC'13, https://ppl.stanford.edu/papers/sc13-hong.pdf), then run Tarjan on the cyclic core.
- **Evidence:** Wang et al., SIGMOD 2023 (arXiv:2303.04934) report that many parallel SCC codes lose to sequential Tarjan on large-diameter graphs. Import graphs can be deep. At 2k to 20k nodes I expect a few ms **(est.)**. Measure first.

## Recommended plan

1. **Instrument and rebalance (technique 1).** Time read, convert, lex and graph, split work by bytes, and confirm the 1.6-core cause.
2. **Pack the text (techniques 2 and 4).** Use packed words in a flat `Array` with bitmap classes. Keep the token logic, and diff token streams against the fixtures.
3. **Add SWAR skip loops (technique 3).** Cover string, comment, template and identifier bodies, then re-measure.
4. **Only if big files still dominate,** prototype chunk enumeration (technique 5) above a size threshold, with an Ogden-style brace-stack summary. Verify it against the serial lexer.
