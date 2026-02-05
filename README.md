# WATX

**WAT + HTML = WATX** — A reactive UI framework written in WebAssembly.

WATX extends the [WebAssembly Text Format (WAT)](https://webassembly.github.io/spec/core/text/index.html) with HTML templates and reactive signals, creating a novel way to build web UIs where state lives in WASM and the DOM updates automatically.

```
(module
  (signal $count i32 0)

  (component $Counter
    <div>
      <span>{get $count}</span>
      <button onClick={set $count (i32.add (get $count) (i32.const 1))}>+</button>
    </div>
  )

  (export "Counter" (component $Counter))
)
```

> Inspired by a conversation between [@SharingPsyche](https://twitter.com/SharingPsyche) and [@RyanCarniato](https://twitter.com/RyanCarniato) (creator of [SolidJS](https://github.com/solidjs/solid)) about whether you could create a frontend framework in WebAssembly using the WAT text format.

## How It Works

WATX combines three ideas:

1. **S-expressions from WAT** — The familiar `(module ...)` syntax defines structure
2. **HTML templates in components** — Embedded HTML with `{reactive expressions}` for the view
3. **Signals from SolidJS** — Fine-grained reactivity where `get`/`set` are intercepted to auto-track dependencies

### Architecture

```
  .watx source
      |
      v
  [Lexer] --> tokens
      |
      v
  [Parser] --> AST
      |
      v
  [Compiler]
   /      \
  v        v
.wat      .js
(signals) (DOM + reactivity)
  |
  v
.wasm (via wat2wasm)
```

The compiler produces two outputs:

- **WAT/WASM** — Signal state lives as mutable WASM globals. Getter/setter functions are exported so JavaScript can read and write signal values at native speed.
- **JavaScript** — A SolidJS-inspired reactive runtime creates the DOM, sets up event handlers, and establishes fine-grained subscriptions. When a signal changes, only the exact DOM nodes that read that signal update.

### Signal Flow

```
  User clicks [+] button
       |
       v
  JS event handler fires
       |
       v
  set_count(count() + 1)
       |
       v
  WASM global.set $count   <-- state lives in WebAssembly
       |
       v
  Reactive runtime notifies subscribers
       |
       v
  Effect re-runs: span.textContent = count()
       |
       v
  DOM updates (fine-grained, no virtual DOM)
```

## Quick Start

```bash
# Build a .watx file
node src/cli.js build examples/counter/counter.watx --out dist/counter

# Or serve with dev server
node src/cli.js serve examples/counter/counter.watx --port 3000
```

### Build Output

```
dist/counter/
  counter.wat          # WebAssembly text format (signals as globals)
  counter.wasm         # Compiled WASM binary (if wat2wasm installed)
  counter.js           # Generated JS (DOM + reactive bindings)
  watx-runtime.js      # SolidJS-inspired reactivity runtime
  index.html           # Entry point with styling
```

## The Language

### Signals

Signals are reactive state stored as WASM globals:

```
(signal $count i32 0)       ;; i32 signal, initial value 0
(signal $price f64 9.99)    ;; f64 signal, initial value 9.99
```

### Components

Components contain HTML templates with reactive expressions:

```
(component $Counter
  <div class="counter">
    <span>{get $count}</span>
    <button onClick={set $count (i32.add (get $count) (i32.const 1))}>
      Increment
    </button>
  </div>
)
```

### Reactive Expressions

Inside `{}`, you use S-expressions with `get` and `set`:

```
{get $count}                                           ;; read a signal
{set $count (i32.const 0)}                             ;; set to constant
{set $count (i32.add (get $count) (i32.const 1))}     ;; increment
{set $count (i32.mul (get $count) (i32.const 2))}     ;; double
```

### Events

HTML event attributes map to DOM events:

```
onClick={...}      ;; click
onInput={...}      ;; input
onChange={...}      ;; change
onKeyDown={...}    ;; keydown
onSubmit={...}     ;; submit
```

### Exports

Export components to make them available:

```
(export "Counter" (component $Counter))
```

### WAT Operations

All standard WAT operations work in reactive expressions:

| Operation | Example |
|-----------|---------|
| `i32.add` | `(i32.add (get $x) (i32.const 1))` |
| `i32.sub` | `(i32.sub (get $x) (i32.const 1))` |
| `i32.mul` | `(i32.mul (get $x) (i32.const 2))` |
| `i32.div_s` | `(i32.div_s (get $x) (i32.const 2))` |
| `i32.rem_s` | `(i32.rem_s (get $x) (i32.const 3))` |
| `i32.eq` | `(i32.eq (get $x) (i32.const 0))` |
| `i32.const` | `(i32.const 42)` |

## Examples

### Counter

The classic counter — state in WASM, reactivity in JS:

```
(module
  (signal $count i32 0)

  (component $Counter
    <div class="counter">
      <h2>WATX Counter</h2>
      <span class="count">{get $count}</span>
      <div class="buttons">
        <button onClick={set $count (i32.sub (get $count) (i32.const 1))}>-</button>
        <button onClick={set $count (i32.add (get $count) (i32.const 1))}>+</button>
      </div>
    </div>
  )

  (export "Counter" (component $Counter))
)
```

### Temperature Converter

Multiple signals in one module:

```
(module
  (signal $celsius i32 0)
  (signal $fahrenheit i32 32)

  (component $TemperatureConverter
    <div class="converter">
      <h2>Temperature Converter</h2>
      <div class="row">
        <label>Celsius</label>
        <span class="value">{get $celsius}</span>
        <div class="buttons">
          <button onClick={set $celsius (i32.sub (get $celsius) (i32.const 1))}>-</button>
          <button onClick={set $celsius (i32.add (get $celsius) (i32.const 1))}>+</button>
        </div>
      </div>
    </div>
  )

  (export "TemperatureConverter" (component $TemperatureConverter))
)
```

### Stopwatch

Simple state machine with signals:

```
(module
  (signal $seconds i32 0)
  (signal $running i32 0)

  (component $Stopwatch
    <div class="stopwatch">
      <h2>WATX Stopwatch</h2>
      <span class="time">{get $seconds}</span>
      <div class="buttons">
        <button onClick={set $running (i32.const 1)}>Start</button>
        <button onClick={set $running (i32.const 0)}>Stop</button>
        <button onClick={set $seconds (i32.const 0)}>Reset</button>
      </div>
    </div>
  )

  (export "Stopwatch" (component $Stopwatch))
)
```

## CLI

```
watx build <input.watx> [--out <dir>] [--name <name>]
watx serve <input.watx> [--port <port>]
watx parse <input.watx>     # Debug: show AST
watx tokens <input.watx>    # Debug: show token stream
```

## Runtime API

The SolidJS-inspired reactive system:

```javascript
const runtime = createRuntime();

// Signals backed by WASM globals
const [count, setCount] = runtime.createSignal(
  () => wasm.signal_get_count(),      // WASM getter
  (v) => wasm.signal_set_count(v),    // WASM setter
  0                                    // initial value
);

// Auto-tracking effects (re-run when signals change)
runtime.createEffect(() => {
  element.textContent = String(count());  // reads count, auto-subscribes
});

// Computed values
const doubled = runtime.createMemo(() => count() * 2);

// Batched updates (single DOM update)
runtime.batch(() => {
  setCount(1);
  setOther(2);
});
```

## Generated WAT

For the counter example, WATX generates this WAT:

```wat
(module
  (global $count (mut i32) (i32.const 0))

  (func $signal_get_count (result i32)
    (global.get $count)
  )
  (func $signal_set_count (param $value i32)
    (global.set $count (local.get $value))
  )

  (export "signal_get_count" (func $signal_get_count))
  (export "signal_set_count" (func $signal_set_count))
)
```

Signal state lives as native WASM globals — no JavaScript object overhead, no garbage collection, pure WebAssembly speed.

## Tests

```bash
node --test tests/*.test.js
```

```
# tests 35
# suites 11
# pass 35
# fail 0
```

Test coverage:
- **Lexer** (6 tests): tokenization of S-expressions, HTML, reactive expressions
- **Parser** (6 tests): AST generation, nested HTML, reactive expressions
- **WAT Generator** (3 tests): signal globals, getter/setter functions, reactive compilation
- **JS Generator** (2 tests): DOM structure, event handlers, reactive effects
- **Full Compiler** (3 tests): end-to-end compilation, WASM validation, multi-signal support
- **Runtime** (15 tests): signals, effects, batching, memos, WASM integration patterns

## Project Structure

```
watx/
  src/
    parser/
      lexer.js         # Tokenizer for S-expressions + HTML
      parser.js         # AST builder
    compiler/
      index.js          # Main compiler pipeline
      wat-generator.js  # WATX AST -> WAT source
      js-generator.js   # WATX AST -> JS glue code
    runtime/
      runtime.js        # SolidJS-inspired reactivity + DOM helpers
    cli.js              # CLI tool
    index.js            # Library entry point
  examples/
    counter/            # Classic counter
    temperature/        # Temperature converter
    stopwatch/          # Stopwatch timer
  tests/
    parser.test.js      # Lexer + parser tests
    compiler.test.js    # WAT/JS generator + E2E WASM tests
    runtime.test.js     # Reactive system tests
  dist/                 # Build output
```

## Design Decisions

**Why signals in WASM?**
State as WASM globals means arithmetic operations (increment, comparison, etc.) can eventually run at native speed. The JS layer only handles DOM and event bridging.

**Why SolidJS-style reactivity?**
SolidJS pioneered fine-grained reactivity without a virtual DOM. Each `{get $count}` in WATX compiles to a reactive effect that updates exactly one text node — no diffing, no reconciliation.

**Why S-expressions?**
WAT already uses S-expressions. By extending the syntax (rather than inventing a new one), WATX stays close to the metal while adding just enough abstraction for UI.

## Credits

- [SolidJS](https://github.com/solidjs/solid) by Ryan Carniato — the reactive system is inspired by SolidJS signals
- [WebAssembly](https://webassembly.org/) — the runtime target
- The original idea from a conversation about building a frontend framework in WASM using WAT syntax

## License

MIT
