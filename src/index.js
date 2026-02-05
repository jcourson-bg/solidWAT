/**
 * WATX — WAT + HTML = WATX
 * A reactive UI framework written in WebAssembly
 *
 * Exports the core compiler and parser APIs.
 */

export { Lexer, tokenize, TokenType } from './parser/lexer.js';
export { Parser, parse } from './parser/parser.js';
export { compile, Compiler } from './compiler/index.js';
export { WatGenerator } from './compiler/wat-generator.js';
export { JsGenerator } from './compiler/js-generator.js';
