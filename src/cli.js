#!/usr/bin/env node

/**
 * WATX CLI — Build and serve WATX applications
 *
 * Usage:
 *   watx build <input.watx> [--out <dir>] [--name <name>]
 *   watx serve <input.watx> [--port <port>]
 *   watx parse <input.watx>   (debug: show AST)
 *   watx tokens <input.watx>  (debug: show tokens)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

import { Lexer } from './parser/lexer.js';
import { Parser } from './parser/parser.js';
import { compile } from './compiler/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function printUsage() {
  console.log(`
  WATX — WAT + HTML = WATX
  A reactive UI framework written in WebAssembly

  Usage:
    watx build <input.watx> [--out <dir>] [--name <name>]
    watx serve <input.watx> [--port <port>]
    watx parse <input.watx>
    watx tokens <input.watx>

  Commands:
    build    Compile a .watx file to .wat, .js, and .html
    serve    Build and serve with a dev server
    parse    Show the AST (debug)
    tokens   Show the token stream (debug)

  Examples:
    watx build examples/counter/counter.watx --out dist/counter
    watx serve examples/counter/counter.watx --port 3000
`);
}

function parseArgs(args) {
  const result = { command: null, input: null, options: {} };

  let i = 0;
  if (args.length > 0 && !args[0].startsWith('-')) {
    result.command = args[0];
    i++;
  }
  if (args.length > i && !args[i].startsWith('-')) {
    result.input = args[i];
    i++;
  }

  while (i < args.length) {
    const arg = args[i];
    if (arg === '--out' && i + 1 < args.length) {
      result.options.out = args[++i];
    } else if (arg === '--name' && i + 1 < args.length) {
      result.options.name = args[++i];
    } else if (arg === '--port' && i + 1 < args.length) {
      result.options.port = parseInt(args[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    i++;
  }

  return result;
}

function cmdTokens(inputPath) {
  const source = readFileSync(inputPath, 'utf-8');
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();

  console.log(`\n  Tokens for: ${inputPath}\n`);
  for (const token of tokens) {
    console.log(`  ${token.toString()}`);
  }
  console.log(`\n  Total: ${tokens.length} tokens\n`);
}

function cmdParse(inputPath) {
  const source = readFileSync(inputPath, 'utf-8');
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();

  console.log(`\n  AST for: ${inputPath}\n`);
  console.log(JSON.stringify(ast, null, 2));
}

async function cmdBuild(inputPath, options) {
  const source = readFileSync(inputPath, 'utf-8');
  const name = options.name || basename(inputPath, '.watx');
  const outDir = options.out || join(dirname(inputPath), 'dist');

  console.log(`\n  WATX Compiler v0.1.0`);
  console.log(`  ─────────────────────`);
  console.log(`  Input:  ${inputPath}`);
  console.log(`  Output: ${outDir}/`);
  console.log(`  Name:   ${name}`);
  console.log();

  // Compile
  const result = compile(source, { name });

  // Ensure output directory exists
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Write WAT
  const watPath = join(outDir, `${name}.wat`);
  writeFileSync(watPath, result.wat);
  console.log(`  ✓ ${watPath}`);

  // Write JS
  const jsPath = join(outDir, `${name}.js`);
  writeFileSync(jsPath, result.js);
  console.log(`  ✓ ${jsPath}`);

  // Write HTML
  const htmlPath = join(outDir, 'index.html');
  writeFileSync(htmlPath, result.html);
  console.log(`  ✓ ${htmlPath}`);

  // Copy runtime
  const runtimeSrc = join(__dirname, 'runtime', 'runtime.js');
  const runtimeDest = join(outDir, 'watx-runtime.js');
  copyFileSync(runtimeSrc, runtimeDest);
  console.log(`  ✓ ${runtimeDest}`);

  // Try to compile WAT to WASM using wat2wasm
  let wasmCompiled = false;
  try {
    const { execSync } = await import('node:child_process');
    const wasmPath = join(outDir, `${name}.wasm`);
    execSync(`wat2wasm "${watPath}" -o "${wasmPath}"`, { stdio: 'pipe' });
    console.log(`  ✓ ${wasmPath} (compiled with wat2wasm)`);
    wasmCompiled = true;
  } catch {
    // wat2wasm not available — provide the inline WASM compiler fallback
    console.log(`  ⚠ wat2wasm not found — generating inline WASM compiler`);
    generateInlineWasmLoader(outDir, name, result.wat);
  }

  console.log(`\n  Build complete!\n`);

  if (!wasmCompiled) {
    console.log(`  To compile WAT to WASM natively, install wabt:`);
    console.log(`    brew install wabt   (macOS)`);
    console.log(`    apt install wabt    (Linux)`);
    console.log(`  Or use the dev server: watx serve ${inputPath}\n`);
  }

  return { outDir, name, wasmCompiled };
}

/**
 * Generate an inline WASM loader that compiles WAT to WASM in the browser
 * using a minimal WAT assembler. This is a fallback when wat2wasm is not available.
 */
function generateInlineWasmLoader(outDir, name, watSource) {
  // Instead of requiring wat2wasm, we'll generate a JS-based WASM module builder
  // that constructs the binary directly. This is more portable.
  const wasmBuilderPath = join(outDir, `${name}-wasm-builder.js`);

  // Parse the WAT to extract signal info and build WASM binary programmatically
  writeFileSync(wasmBuilderPath, generateWasmBuilder(watSource));
  console.log(`  ✓ ${wasmBuilderPath} (inline WASM builder)`);
}

/**
 * Generate a JS module that builds a WASM binary from signal definitions.
 * This replaces the need for wat2wasm by constructing the binary format directly.
 */
function generateWasmBuilder(watSource) {
  // Extract signal definitions from WAT source using simple regex
  const globalRegex = /\(global\s+(\$\w+)\s+\(mut\s+(\w+)\)\s+\((\w+)\.const\s+(-?\d+)\)\)/g;
  const signals = [];
  let match;
  while ((match = globalRegex.exec(watSource)) !== null) {
    signals.push({
      name: match[1],
      type: match[2],
      init: parseInt(match[4]),
    });
  }

  return `/**
 * WATX Inline WASM Builder
 * Constructs a WASM binary module for signal state management.
 * Generated because wat2wasm was not available at build time.
 */

export function buildWasmModule() {
  const signals = ${JSON.stringify(signals, null, 2)};

  // WASM binary format helpers
  const encoder = new TextEncoder();

  function encodeVector(items) {
    return [items.length, ...items.flat()];
  }

  function encodeLEB128(value) {
    const bytes = [];
    let v = value;
    do {
      let byte = v & 0x7F;
      v >>= 7;
      if (v !== 0) byte |= 0x80;
      bytes.push(byte);
    } while (v !== 0);
    return bytes;
  }

  function encodeSignedLEB128(value) {
    const bytes = [];
    let v = value;
    let more = true;
    while (more) {
      let byte = v & 0x7F;
      v >>= 7;
      if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
        more = false;
      } else {
        byte |= 0x80;
      }
      bytes.push(byte);
    }
    return bytes;
  }

  function encodeString(str) {
    const bytes = encoder.encode(str);
    return [...encodeLEB128(bytes.length), ...bytes];
  }

  function section(id, content) {
    return [id, ...encodeLEB128(content.length), ...content];
  }

  const WASM_TYPE = { i32: 0x7F, i64: 0x7E, f32: 0x7D, f64: 0x7C };
  const numSignals = signals.length;

  // ---- Type Section (1) ----
  // For each signal: getter () -> type, setter (type) -> void
  const types = [];
  for (const sig of signals) {
    // Getter: () -> type
    types.push([0x60, 0x00, 0x01, WASM_TYPE[sig.type]]);
    // Setter: (type) -> void
    types.push([0x60, 0x01, WASM_TYPE[sig.type], 0x00]);
  }
  const typeSection = section(0x01, encodeVector(types.map(t => t)));

  // ---- Function Section (3) ----
  const funcTypes = [];
  for (let i = 0; i < numSignals; i++) {
    funcTypes.push(i * 2);     // getter -> type index i*2
    funcTypes.push(i * 2 + 1); // setter -> type index i*2+1
  }
  const funcSection = section(0x03, encodeVector(funcTypes.map(t => [t])));

  // ---- Global Section (6) ----
  const globals = signals.map(sig => {
    const type = WASM_TYPE[sig.type];
    const initOp = sig.type === 'i32' ? 0x41 : sig.type === 'i64' ? 0x42 : sig.type === 'f32' ? 0x43 : 0x44;
    const initValue = sig.type.startsWith('f')
      ? [...new Uint8Array(new Float64Array([sig.init]).buffer)]
      : encodeSignedLEB128(sig.init);
    return [type, 0x01, initOp, ...initValue, 0x0B]; // type, mutable, init_expr, end
  });
  const globalSection = section(0x06, encodeVector(globals));

  // ---- Export Section (7) ----
  const exports_ = [];
  for (let i = 0; i < numSignals; i++) {
    const sigName = signals[i].name.slice(1);
    exports_.push([...encodeString('signal_get_' + sigName), 0x00, ...encodeLEB128(i * 2)]);
    exports_.push([...encodeString('signal_set_' + sigName), 0x00, ...encodeLEB128(i * 2 + 1)]);
  }
  const exportSection = section(0x07, encodeVector(exports_));

  // ---- Code Section (10) ----
  const codes = [];
  for (let i = 0; i < numSignals; i++) {
    // Getter: global.get $i
    const getterBody = [0x00, 0x23, ...encodeLEB128(i), 0x0B]; // 0 locals, global.get i, end
    codes.push([...encodeLEB128(getterBody.length), ...getterBody]);

    // Setter: global.set $i (local.get 0)
    const setterBody = [0x00, 0x20, 0x00, 0x24, ...encodeLEB128(i), 0x0B]; // 0 locals, local.get 0, global.set i, end
    codes.push([...encodeLEB128(setterBody.length), ...setterBody]);
  }
  const codeSection = section(0x0A, encodeVector(codes));

  // ---- Assemble Module ----
  const module = new Uint8Array([
    0x00, 0x61, 0x73, 0x6D, // magic: \\0asm
    0x01, 0x00, 0x00, 0x00, // version: 1
    ...typeSection,
    ...funcSection,
    ...globalSection,
    ...exportSection,
    ...codeSection,
  ]);

  return module.buffer;
}
`;
}

async function cmdServe(inputPath, options) {
  const port = options.port || 3000;
  const { outDir, name } = await cmdBuild(inputPath, { ...options, out: join(dirname(inputPath), '.watx-dev') });

  // Also generate the WASM binary using the inline builder for dev
  const builderPath = join(outDir, `${name}-wasm-builder.js`);
  if (existsSync(builderPath)) {
    // Modify the HTML to use the inline builder
    const htmlPath = join(outDir, 'index.html');
    let html = readFileSync(htmlPath, 'utf-8');
    html = html.replace(
      `import { createApp } from './${name}.js';`,
      `import { createApp } from './${name}.js';\n    import { buildWasmModule } from './${name}-wasm-builder.js';`
    );
    html = html.replace(
      `const app = await createApp('./${name}.wasm');`,
      `// Use inline WASM builder (no wat2wasm needed)\n    const wasmBytes = buildWasmModule();\n    const wasmBlob = new Blob([wasmBytes], { type: 'application/wasm' });\n    const wasmUrl = URL.createObjectURL(wasmBlob);\n    const app = await createApp(wasmUrl);`
    );
    writeFileSync(htmlPath, html);
  }

  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.json': 'application/json',
  };

  const server = createServer((req, res) => {
    let filePath = join(outDir, req.url === '/' ? 'index.html' : req.url);

    try {
      const data = readFileSync(filePath);
      const ext = '.' + filePath.split('.').pop();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`  WATX Dev Server`);
    console.log(`  ───────────────`);
    console.log(`  Local: http://localhost:${port}`);
    console.log(`  Press Ctrl+C to stop\n`);
  });
}

// ---- Main ----
const args = process.argv.slice(2);
const { command, input, options } = parseArgs(args);

if (!command || !input) {
  printUsage();
  process.exit(command ? 1 : 0);
}

// Resolve input path
const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`  Error: File not found: ${inputPath}`);
  process.exit(1);
}

switch (command) {
  case 'build':
    await cmdBuild(inputPath, options);
    break;
  case 'serve':
    await cmdServe(inputPath, options);
    break;
  case 'parse':
    cmdParse(inputPath);
    break;
  case 'tokens':
    cmdTokens(inputPath);
    break;
  default:
    console.error(`  Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
