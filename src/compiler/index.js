/**
 * WATX Compiler — Main entry point
 *
 * Takes a .watx source file and produces:
 *   1. A .wat file (WebAssembly Text Format) for signal state management
 *   2. A .js file (JavaScript) for DOM manipulation and reactive bindings
 *   3. A .wasm file (compiled from .wat via wat2wasm if available)
 *   4. An .html file (entry point) that loads the app
 *
 * The compiler pipeline:
 *   Source (.watx) → Lexer → Tokens → Parser → AST → WAT + JS generators → Output
 */

import { Lexer } from '../parser/lexer.js';
import { Parser } from '../parser/parser.js';
import { WatGenerator } from './wat-generator.js';
import { JsGenerator } from './js-generator.js';

export class Compiler {
  constructor(source, options = {}) {
    this.source = source;
    this.options = {
      name: options.name || 'app',
      minify: options.minify || false,
      ...options,
    };
  }

  /**
   * Run the full compilation pipeline
   */
  compile() {
    // 1. Lex
    const lexer = new Lexer(this.source);
    const tokens = lexer.tokenize();

    // 2. Parse
    const parser = new Parser(tokens);
    const ast = parser.parse();

    // 3. Generate WAT
    const watGen = new WatGenerator(ast);
    const watSource = watGen.generate();
    const signalInfo = watGen.getSignalInfo();

    // 4. Generate JS
    const jsGen = new JsGenerator(ast);
    const jsSource = jsGen.generate();

    // 5. Generate HTML entry point
    const htmlSource = this.generateHtml(signalInfo);

    // 6. Get the runtime source (to be bundled)
    const runtimeNote = '// Runtime is provided as watx-runtime.js';

    return {
      ast,
      wat: watSource,
      js: jsSource,
      html: htmlSource,
      signalInfo,
      runtimeNote,
    };
  }

  /**
   * Generate the HTML entry point
   */
  generateHtml(signalInfo) {
    const name = this.options.name;
    const title = name.charAt(0).toUpperCase() + name.slice(1);

    // Find the first exported component
    const ast = new Parser(new Lexer(this.source).tokenize()).parse();
    const exports = ast.body.filter(n => n.type === 'Export' && n.kind === 'component');
    const mainExport = exports.length > 0 ? exports[0].exportName : 'App';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — WATX App</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
      color: #e0e0e0;
    }
    #app {
      text-align: center;
      padding: 2rem;
    }
    .counter {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 2.5rem 3rem;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    .counter h2 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      background: linear-gradient(90deg, #7f5af0, #2cb67d);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .count {
      display: block;
      font-size: 4rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      margin: 1rem 0;
      color: #fffffe;
    }
    .buttons {
      display: flex;
      gap: 1rem;
      justify-content: center;
      margin-top: 1rem;
    }
    button {
      font-size: 1.25rem;
      font-weight: 600;
      padding: 0.6rem 1.5rem;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
      background: #7f5af0;
      color: #fffffe;
    }
    button:hover { background: #6b46e5; transform: translateY(-1px); }
    button:active { transform: translateY(0); }
    .watx-badge {
      margin-top: 2rem;
      font-size: 0.75rem;
      opacity: 0.5;
    }
    .watx-badge code {
      background: rgba(255,255,255,0.1);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { createApp } from './${name}.js';

    const app = await createApp('./${name}.wasm');
    app.mount(app.${mainExport}, '#app');
  </script>
</body>
</html>`;
  }
}

/**
 * Compile WATX source to output artifacts
 */
export function compile(source, options = {}) {
  const compiler = new Compiler(source, options);
  return compiler.compile();
}
