import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Lexer } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { WatGenerator } from '../src/compiler/wat-generator.js';
import { JsGenerator } from '../src/compiler/js-generator.js';
import { compile } from '../src/compiler/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('WatGenerator', () => {
  it('should generate WAT for a signal', () => {
    const source = '(module (signal $count i32 0))';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const gen = new WatGenerator(ast);
    const wat = gen.generate();

    assert.ok(wat.includes('(global $count (mut i32) (i32.const 0))'));
    assert.ok(wat.includes('(func $signal_get_count'));
    assert.ok(wat.includes('(func $signal_set_count'));
    assert.ok(wat.includes('(export "signal_get_count"'));
    assert.ok(wat.includes('(export "signal_set_count"'));
  });

  it('should generate valid signal info', () => {
    const source = '(module (signal $x i32 42) (signal $y f64 3.14))';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const gen = new WatGenerator(ast);
    gen.generate();
    const info = gen.getSignalInfo();

    assert.equal(info.length, 2);
    assert.equal(info[0].name, '$x');
    assert.equal(info[0].type, 'i32');
    assert.equal(info[0].initialValue, 42);
    assert.equal(info[0].getterName, 'signal_get_x');
    assert.equal(info[1].name, '$y');
    assert.equal(info[1].type, 'f64');
  });

  it('should compile reactive expressions', () => {
    const source = '(module (signal $count i32 0))';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const gen = new WatGenerator(ast);
    gen.generate();

    // Test get compilation
    const getExpr = { type: 'SExpr', op: 'get', args: [{ type: 'DollarId', name: '$count' }] };
    const getResult = gen.compileReactiveExpr(getExpr);
    assert.equal(getResult.kind, 'signal_get');
    assert.equal(getResult.signal, 'count');

    // Test set compilation
    const setExpr = {
      type: 'SExpr', op: 'set',
      args: [
        { type: 'DollarId', name: '$count' },
        { type: 'SExpr', op: 'i32.add', args: [
          { type: 'SExpr', op: 'get', args: [{ type: 'DollarId', name: '$count' }] },
          { type: 'SExpr', op: 'i32.const', args: [{ type: 'NumberLiteral', value: 1 }] },
        ]},
      ],
    };
    const setResult = gen.compileReactiveExpr(setExpr);
    assert.equal(setResult.kind, 'signal_set');
    assert.equal(setResult.signal, 'count');
    assert.equal(setResult.value.kind, 'wasm_op');
    assert.equal(setResult.value.op, 'i32.add');
  });
});

describe('JsGenerator', () => {
  it('should generate JS for the counter example', () => {
    const source = readFileSync(join(__dirname, '../examples/counter/counter.watx'), 'utf-8');
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const gen = new JsGenerator(ast);
    const js = gen.generate();

    // Should import runtime
    assert.ok(js.includes("import { createRuntime }"));
    // Should create WASM-backed signal
    assert.ok(js.includes("const [count, set_count] = createSignal("));
    assert.ok(js.includes("wasm.signal_get_count()"));
    assert.ok(js.includes("wasm.signal_set_count(v)"));
    // Should have the component
    assert.ok(js.includes("function render_Counter()"));
    // Should have reactive effect
    assert.ok(js.includes("createEffect("));
    assert.ok(js.includes("count()"));
    // Should have event handlers
    assert.ok(js.includes("addEventListener('click'"));
    assert.ok(js.includes("set_count("));
    // Should have arithmetic
    assert.ok(js.includes("count() + 1"));
    assert.ok(js.includes("count() - 1"));
    // Should export
    assert.ok(js.includes("Counter: render_Counter"));
  });

  it('should generate correct DOM structure', () => {
    const source = `(module
      (component $App
        <div class="app">
          <h1>Hello</h1>
          <p>World</p>
        </div>
      )
      (export "App" (component $App))
    )`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const gen = new JsGenerator(ast);
    const js = gen.generate();

    assert.ok(js.includes("h('div')"));
    assert.ok(js.includes("setAttribute('class', 'app')"));
    assert.ok(js.includes("h('h1')"));
    assert.ok(js.includes("h('p')"));
    assert.ok(js.includes("text('Hello')"));
    assert.ok(js.includes("text('World')"));
    assert.ok(js.includes("appendChild"));
  });
});

describe('Full Compiler', () => {
  it('should compile the counter example', () => {
    const source = readFileSync(join(__dirname, '../examples/counter/counter.watx'), 'utf-8');
    const result = compile(source, { name: 'counter' });

    assert.ok(result.wat);
    assert.ok(result.js);
    assert.ok(result.html);
    assert.ok(result.ast);
    assert.ok(result.signalInfo);
    assert.equal(result.signalInfo.length, 1);
  });

  it('should generate valid WAT that wat2wasm can compile', async () => {
    const source = readFileSync(join(__dirname, '../examples/counter/counter.watx'), 'utf-8');
    const result = compile(source, { name: 'counter' });

    // Compile WAT to WASM using wat2wasm
    const { execSync } = await import('node:child_process');
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const tmpWat = join(__dirname, '_test_tmp.wat');
    const tmpWasm = join(__dirname, '_test_tmp.wasm');

    try {
      writeFileSync(tmpWat, result.wat);
      execSync(`wat2wasm "${tmpWat}" -o "${tmpWasm}"`, { stdio: 'pipe' });

      // Load and validate the WASM module
      const wasmBytes = readFileSync(tmpWasm);
      const wasmModule = await WebAssembly.instantiate(wasmBytes);
      const wasm = wasmModule.instance.exports;

      // Test signal getter
      assert.equal(typeof wasm.signal_get_count, 'function');
      assert.equal(wasm.signal_get_count(), 0);

      // Test signal setter
      assert.equal(typeof wasm.signal_set_count, 'function');
      wasm.signal_set_count(42);
      assert.equal(wasm.signal_get_count(), 42);

      // Test incrementing
      wasm.signal_set_count(wasm.signal_get_count() + 1);
      assert.equal(wasm.signal_get_count(), 43);

      // Test decrementing
      wasm.signal_set_count(wasm.signal_get_count() - 1);
      assert.equal(wasm.signal_get_count(), 42);

    } finally {
      try { unlinkSync(tmpWat); } catch {}
      try { unlinkSync(tmpWasm); } catch {}
    }
  });

  it('should generate WASM that handles multiple signals', async () => {
    const source = `(module
      (signal $x i32 10)
      (signal $y i32 20)
    )`;
    const result = compile(source, { name: 'multi' });

    const { execSync } = await import('node:child_process');
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const tmpWat = join(__dirname, '_test_multi.wat');
    const tmpWasm = join(__dirname, '_test_multi.wasm');

    try {
      writeFileSync(tmpWat, result.wat);
      execSync(`wat2wasm "${tmpWat}" -o "${tmpWasm}"`, { stdio: 'pipe' });

      const wasmBytes = readFileSync(tmpWasm);
      const wasmModule = await WebAssembly.instantiate(wasmBytes);
      const wasm = wasmModule.instance.exports;

      assert.equal(wasm.signal_get_x(), 10);
      assert.equal(wasm.signal_get_y(), 20);

      wasm.signal_set_x(100);
      assert.equal(wasm.signal_get_x(), 100);
      assert.equal(wasm.signal_get_y(), 20); // y unchanged

      wasm.signal_set_y(200);
      assert.equal(wasm.signal_get_x(), 100);
      assert.equal(wasm.signal_get_y(), 200);
    } finally {
      try { unlinkSync(tmpWat); } catch {}
      try { unlinkSync(tmpWasm); } catch {}
    }
  });
});
