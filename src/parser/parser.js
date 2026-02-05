/**
 * WATX Parser — Produces an AST from WATX tokens
 *
 * AST Node Types:
 *   - Module: top-level (module ...) container
 *   - Signal: (signal $name type initialValue)
 *   - Component: (component $name <html>...</html>)
 *   - Export: (export "name" (component $ref))
 *   - Func: (func $name (param ...) (result ...) ...)
 *   - HtmlElement: <tag attr="val">children</tag>
 *   - HtmlText: plain text in HTML
 *   - ReactiveExpr: {expression} in HTML
 *   - SExpr: generic S-expression (for WAT instructions)
 *   - Identifier / DollarId / NumberLiteral / StringLiteral
 */

import { TokenType } from './lexer.js';

// AST Node constructors
export class ASTNode {
  constructor(type, props = {}) {
    this.type = type;
    Object.assign(this, props);
  }
}

export function Module(body) {
  return new ASTNode('Module', { body });
}

export function Signal(name, valueType, initialValue) {
  return new ASTNode('Signal', { name, valueType, initialValue });
}

export function Component(name, template) {
  return new ASTNode('Component', { name, template });
}

export function ExportDecl(exportName, kind, ref) {
  return new ASTNode('Export', { exportName, kind, ref });
}

export function Func(name, params, results, body) {
  return new ASTNode('Func', { name, params, results, body });
}

export function HtmlElement(tag, attributes, children) {
  return new ASTNode('HtmlElement', { tag, attributes, children });
}

export function HtmlText(value) {
  return new ASTNode('HtmlText', { value });
}

export function ReactiveExpr(expr) {
  return new ASTNode('ReactiveExpr', { expr });
}

export function SExpr(op, args) {
  return new ASTNode('SExpr', { op, args });
}

export function Identifier(name) {
  return new ASTNode('Identifier', { name });
}

export function DollarId(name) {
  return new ASTNode('DollarId', { name });
}

export function NumberLiteral(value) {
  return new ASTNode('NumberLiteral', { value: Number(value), raw: String(value) });
}

export function StringLiteral(value) {
  return new ASTNode('StringLiteral', { value });
}

export class ParserError extends Error {
  constructor(message, token) {
    const loc = token ? ` at ${token.line}:${token.col}` : '';
    super(`Parser error${loc}: ${message}`);
    this.token = token;
  }
}

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    if (this.pos >= this.tokens.length) return null;
    return this.tokens[this.pos];
  }

  advance() {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  expect(type, value) {
    const token = this.advance();
    if (!token || token.type !== type) {
      throw new ParserError(
        `Expected ${type}${value ? ` '${value}'` : ''}, got ${token ? token.type : 'EOF'} '${token?.value}'`,
        token
      );
    }
    if (value !== undefined && token.value !== value) {
      throw new ParserError(
        `Expected '${value}', got '${token.value}'`,
        token
      );
    }
    return token;
  }

  /**
   * Parse the entire WATX file: (module ...)
   */
  parse() {
    this.expect(TokenType.LPAREN);
    this.expect(TokenType.IDENTIFIER, 'module');

    const body = [];
    while (this.peek() && this.peek().type !== TokenType.RPAREN) {
      const node = this.parseModuleItem();
      if (node) body.push(node);
    }

    this.expect(TokenType.RPAREN);
    return Module(body);
  }

  /**
   * Parse a top-level module item: signal, component, export, func, etc.
   */
  parseModuleItem() {
    const token = this.peek();
    if (!token) throw new ParserError('Unexpected end of input');

    if (token.type === TokenType.LPAREN) {
      this.advance(); // consume (
      const keyword = this.peek();

      if (!keyword) throw new ParserError('Unexpected end of input after (');

      switch (keyword.value) {
        case 'signal': return this.parseSignal();
        case 'component': return this.parseComponent();
        case 'export': return this.parseExport();
        case 'func': return this.parseFunc();
        case 'effect': return this.parseEffect();
        case 'memo':
        case 'computed': return this.parseMemo();
        default:
          return this.parseSExpr();
      }
    }

    throw new ParserError(`Unexpected token: ${token.type} '${token.value}'`, token);
  }

  /**
   * Parse: (signal $name i32 0)
   */
  parseSignal() {
    this.expect(TokenType.IDENTIFIER, 'signal');
    const name = this.expect(TokenType.DOLLAR_ID).value;
    const valueType = this.expect(TokenType.KEYWORD).value;
    const initialValue = this.parseAtom();
    this.expect(TokenType.RPAREN);
    return Signal(name, valueType, initialValue);
  }

  /**
   * Parse: (component $Name <html>...</html>)
   */
  parseComponent() {
    this.expect(TokenType.IDENTIFIER, 'component');
    const name = this.expect(TokenType.DOLLAR_ID).value;

    // The template is HTML content
    const template = this.parseHtmlElement();

    this.expect(TokenType.RPAREN);
    return Component(name, template);
  }

  /**
   * Parse: (export "Name" (component $Ref))
   */
  parseExport() {
    this.expect(TokenType.IDENTIFIER, 'export');
    const exportName = this.expect(TokenType.STRING).value;
    this.expect(TokenType.LPAREN);
    const kind = this.expect(TokenType.IDENTIFIER).value; // "component" or "func"
    const ref = this.expect(TokenType.DOLLAR_ID).value;
    this.expect(TokenType.RPAREN);
    this.expect(TokenType.RPAREN);
    return ExportDecl(exportName, kind, ref);
  }

  /**
   * Parse: (func $name (param $x i32) (result i32) ...)
   */
  parseFunc() {
    this.expect(TokenType.IDENTIFIER, 'func');

    let name = null;
    if (this.peek()?.type === TokenType.DOLLAR_ID) {
      name = this.advance().value;
    }

    const params = [];
    const results = [];
    const body = [];

    while (this.peek() && this.peek().type !== TokenType.RPAREN) {
      if (this.peek().type === TokenType.LPAREN) {
        // Check if it's param or result
        const saved = this.pos;
        this.advance(); // (
        const kw = this.peek();

        if (kw?.value === 'param') {
          this.advance(); // param
          const pName = this.peek()?.type === TokenType.DOLLAR_ID ? this.advance().value : null;
          const pType = this.expect(TokenType.KEYWORD).value;
          params.push({ name: pName, type: pType });
          this.expect(TokenType.RPAREN);
          continue;
        }

        if (kw?.value === 'result') {
          this.advance(); // result
          const rType = this.expect(TokenType.KEYWORD).value;
          results.push(rType);
          this.expect(TokenType.RPAREN);
          continue;
        }

        // Not param/result, restore and parse as expression
        this.pos = saved;
        body.push(this.parseSExprFull());
      } else {
        body.push(this.parseAtom());
      }
    }

    this.expect(TokenType.RPAREN);
    return Func(name, params, results, body);
  }

  /**
   * Parse: (effect (...body...))
   */
  parseEffect() {
    this.expect(TokenType.IDENTIFIER, 'effect');
    const body = [];
    while (this.peek() && this.peek().type !== TokenType.RPAREN) {
      if (this.peek().type === TokenType.LPAREN) {
        body.push(this.parseSExprFull());
      } else {
        body.push(this.parseAtom());
      }
    }
    this.expect(TokenType.RPAREN);
    return new ASTNode('Effect', { body });
  }

  /**
   * Parse: (memo $name (...expr...)) or (computed $name (...expr...))
   */
  parseMemo() {
    this.advance(); // skip 'memo' or 'computed'
    const name = this.peek()?.type === TokenType.DOLLAR_ID ? this.advance().value : null;
    const body = [];
    while (this.peek() && this.peek().type !== TokenType.RPAREN) {
      if (this.peek().type === TokenType.LPAREN) {
        body.push(this.parseSExprFull());
      } else {
        body.push(this.parseAtom());
      }
    }
    this.expect(TokenType.RPAREN);
    return new ASTNode('Memo', { name, body });
  }

  /**
   * Parse a full S-expression: (op arg1 arg2 ...)
   */
  parseSExprFull() {
    this.expect(TokenType.LPAREN);
    return this.parseSExpr();
  }

  /**
   * Parse inside an S-expression (after opening paren consumed)
   */
  parseSExpr() {
    let op = null;
    const token = this.peek();

    if (token?.type === TokenType.IDENTIFIER || token?.type === TokenType.KEYWORD) {
      op = this.advance().value;
    } else if (token?.type === TokenType.DOLLAR_ID) {
      op = this.advance().value;
    }

    const args = [];
    while (this.peek() && this.peek().type !== TokenType.RPAREN) {
      if (this.peek().type === TokenType.LPAREN) {
        args.push(this.parseSExprFull());
      } else {
        args.push(this.parseAtom());
      }
    }

    this.expect(TokenType.RPAREN);
    return SExpr(op, args);
  }

  /**
   * Parse an atom: identifier, dollar-id, number, string, keyword
   */
  parseAtom() {
    const token = this.peek();
    if (!token) throw new ParserError('Unexpected end of input');

    switch (token.type) {
      case TokenType.IDENTIFIER:
        this.advance();
        return Identifier(token.value);
      case TokenType.DOLLAR_ID:
        this.advance();
        return DollarId(token.value);
      case TokenType.NUMBER:
        this.advance();
        return NumberLiteral(token.value);
      case TokenType.STRING:
        this.advance();
        return StringLiteral(token.value);
      case TokenType.KEYWORD:
        this.advance();
        return Identifier(token.value);
      default:
        throw new ParserError(`Unexpected token: ${token.type} '${token.value}'`, token);
    }
  }

  /**
   * Parse an HTML element: <tag attrs>children</tag>
   */
  parseHtmlElement() {
    const token = this.peek();

    if (token?.type === TokenType.HTML_OPEN_TAG) {
      const tagToken = this.advance();
      const tag = tagToken.value;
      const attributes = [];
      const children = [];

      // Parse attributes
      while (this.peek() && this.peek().type !== TokenType.HTML_TAG_END && this.peek().type !== TokenType.HTML_SELF_CLOSE) {
        if (this.peek().type === TokenType.HTML_ATTR_NAME) {
          const attrName = this.advance().value;

          if (this.peek()?.type === TokenType.HTML_ATTR_EQ) {
            this.advance(); // skip =
            const attrValue = this.parseHtmlAttrValue();
            attributes.push({ name: attrName, value: attrValue });
          } else {
            // Boolean attribute
            attributes.push({ name: attrName, value: { type: 'BooleanAttr', value: true } });
          }
        } else {
          break;
        }
      }

      // Self-closing tag
      if (this.peek()?.type === TokenType.HTML_SELF_CLOSE) {
        this.advance();
        return HtmlElement(tag, attributes, []);
      }

      // >
      this.expect(TokenType.HTML_TAG_END);

      // Parse children
      while (this.peek() && this.peek().type !== TokenType.HTML_CLOSE_TAG) {
        if (this.peek().type === TokenType.HTML_OPEN_TAG) {
          children.push(this.parseHtmlElement());
        } else if (this.peek().type === TokenType.HTML_TEXT) {
          const textToken = this.advance();
          children.push(HtmlText(textToken.value));
        } else if (this.peek().type === TokenType.LBRACE) {
          children.push(this.parseReactiveExpr());
        } else {
          break;
        }
      }

      // </tag>
      if (this.peek()?.type === TokenType.HTML_CLOSE_TAG) {
        const closeTag = this.advance();
        if (closeTag.value !== tag) {
          throw new ParserError(
            `Mismatched closing tag: expected </${tag}>, got </${closeTag.value}>`,
            closeTag
          );
        }
      }

      return HtmlElement(tag, attributes, children);
    }

    throw new ParserError(
      `Expected HTML element, got ${token?.type} '${token?.value}'`,
      token
    );
  }

  /**
   * Parse an HTML attribute value: "string" or {expr}
   */
  parseHtmlAttrValue() {
    const token = this.peek();

    if (token?.type === TokenType.STRING) {
      this.advance();
      return StringLiteral(token.value);
    }

    if (token?.type === TokenType.LBRACE) {
      return this.parseReactiveExpr();
    }

    throw new ParserError(
      `Expected string or reactive expression for attribute value, got ${token?.type}`,
      token
    );
  }

  /**
   * Parse a reactive expression: { sexpr }
   */
  parseReactiveExpr() {
    this.expect(TokenType.LBRACE);

    // Parse the contents as an S-expression or atom
    let expr;
    if (this.peek()?.type === TokenType.LPAREN) {
      expr = this.parseSExprFull();
    } else if (this.peek()?.type === TokenType.IDENTIFIER || this.peek()?.type === TokenType.KEYWORD) {
      // Could be `get $count` (without parens) or just an identifier
      const id = this.advance();
      if (id.value === 'get' || id.value === 'set') {
        const args = [];
        while (this.peek() && this.peek().type !== TokenType.RBRACE) {
          if (this.peek().type === TokenType.LPAREN) {
            args.push(this.parseSExprFull());
          } else {
            args.push(this.parseAtom());
          }
        }
        expr = SExpr(id.value, args);
      } else {
        expr = Identifier(id.value);
      }
    } else if (this.peek()?.type === TokenType.DOLLAR_ID) {
      expr = this.parseAtom();
    } else {
      expr = this.parseAtom();
    }

    this.expect(TokenType.RBRACE);
    return ReactiveExpr(expr);
  }
}

/**
 * Convenience function to parse WATX source
 */
export function parse(tokens) {
  const parser = new Parser(tokens);
  return parser.parse();
}
