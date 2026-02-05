import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Lexer, TokenType } from '../src/parser/lexer.js';
import { Parser } from '../src/parser/parser.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Lexer', () => {
  it('should tokenize a simple module', () => {
    const source = '(module)';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    assert.equal(tokens[0].type, TokenType.LPAREN);
    assert.equal(tokens[1].type, TokenType.IDENTIFIER);
    assert.equal(tokens[1].value, 'module');
    assert.equal(tokens[2].type, TokenType.RPAREN);
    assert.equal(tokens[3].type, TokenType.EOF);
  });

  it('should tokenize a signal declaration', () => {
    const source = '(signal $count i32 0)';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    assert.equal(tokens[0].type, TokenType.LPAREN);
    assert.equal(tokens[1].type, TokenType.IDENTIFIER);
    assert.equal(tokens[1].value, 'signal');
    assert.equal(tokens[2].type, TokenType.DOLLAR_ID);
    assert.equal(tokens[2].value, '$count');
    assert.equal(tokens[3].type, TokenType.KEYWORD);
    assert.equal(tokens[3].value, 'i32');
    assert.equal(tokens[4].type, TokenType.NUMBER);
    assert.equal(tokens[4].value, '0');
    assert.equal(tokens[5].type, TokenType.RPAREN);
  });

  it('should tokenize HTML with reactive expressions', () => {
    const source = '<div><span>{get $count}</span></div>';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const types = tokens.map(t => t.type);
    assert.ok(types.includes(TokenType.HTML_OPEN_TAG));
    assert.ok(types.includes(TokenType.LBRACE));
    assert.ok(types.includes(TokenType.RBRACE));
    assert.ok(types.includes(TokenType.HTML_CLOSE_TAG));
  });

  it('should tokenize the full counter example', () => {
    const source = readFileSync(join(__dirname, '../examples/counter/counter.watx'), 'utf-8');
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    // Should not throw and should end with EOF
    assert.equal(tokens[tokens.length - 1].type, TokenType.EOF);
    // Should have reasonable number of tokens
    assert.ok(tokens.length > 20);
  });

  it('should handle HTML attributes with string values', () => {
    const source = '<div class="foo">text</div>';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    const classAttr = tokens.find(t => t.type === TokenType.HTML_ATTR_NAME && t.value === 'class');
    assert.ok(classAttr, 'Should find class attribute');
    const strVal = tokens.find(t => t.type === TokenType.STRING && t.value === 'foo');
    assert.ok(strVal, 'Should find string value "foo"');
  });

  it('should handle HTML attributes with reactive values', () => {
    const source = '<button onClick={set $count (i32.add (get $count) (i32.const 1))}>+</button>';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();

    assert.equal(tokens[tokens.length - 1].type, TokenType.EOF);
    const braces = tokens.filter(t => t.type === TokenType.LBRACE || t.type === TokenType.RBRACE);
    assert.ok(braces.length >= 2, 'Should have at least one pair of braces');
  });
});

describe('Parser', () => {
  it('should parse a minimal module', () => {
    const source = '(module)';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    assert.equal(ast.type, 'Module');
    assert.equal(ast.body.length, 0);
  });

  it('should parse a signal declaration', () => {
    const source = '(module (signal $count i32 0))';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    assert.equal(ast.type, 'Module');
    assert.equal(ast.body.length, 1);
    assert.equal(ast.body[0].type, 'Signal');
    assert.equal(ast.body[0].name, '$count');
    assert.equal(ast.body[0].valueType, 'i32');
    assert.equal(ast.body[0].initialValue.value, 0);
  });

  it('should parse an export declaration', () => {
    const source = '(module (export "Counter" (component $Counter)))';
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    assert.equal(ast.body.length, 1);
    assert.equal(ast.body[0].type, 'Export');
    assert.equal(ast.body[0].exportName, 'Counter');
    assert.equal(ast.body[0].kind, 'component');
    assert.equal(ast.body[0].ref, '$Counter');
  });

  it('should parse the full counter example', () => {
    const source = readFileSync(join(__dirname, '../examples/counter/counter.watx'), 'utf-8');
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    assert.equal(ast.type, 'Module');
    // Should have: signal, component, export
    assert.equal(ast.body.length, 3);

    const signal = ast.body.find(n => n.type === 'Signal');
    assert.ok(signal, 'Should have a signal');
    assert.equal(signal.name, '$count');

    const component = ast.body.find(n => n.type === 'Component');
    assert.ok(component, 'Should have a component');
    assert.equal(component.name, '$Counter');
    assert.equal(component.template.type, 'HtmlElement');
    assert.equal(component.template.tag, 'div');

    const exp = ast.body.find(n => n.type === 'Export');
    assert.ok(exp, 'Should have an export');
    assert.equal(exp.exportName, 'Counter');
  });

  it('should parse nested HTML elements', () => {
    const source = `(module
      (component $App
        <div>
          <span>hello</span>
          <p>world</p>
        </div>
      )
    )`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    const comp = ast.body[0];
    assert.equal(comp.type, 'Component');
    assert.equal(comp.template.tag, 'div');
    assert.equal(comp.template.children.length, 2);
    assert.equal(comp.template.children[0].tag, 'span');
    assert.equal(comp.template.children[1].tag, 'p');
  });

  it('should parse reactive expressions in HTML', () => {
    const source = `(module
      (signal $x i32 42)
      (component $App
        <div>{get $x}</div>
      )
    )`;
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();

    const comp = ast.body.find(n => n.type === 'Component');
    const div = comp.template;
    assert.equal(div.children.length, 1);
    assert.equal(div.children[0].type, 'ReactiveExpr');
    assert.equal(div.children[0].expr.op, 'get');
  });
});
