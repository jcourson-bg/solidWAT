/**
 * WATX Lexer — Tokenizer for S-expressions with embedded HTML
 *
 * Handles:
 *   - S-expression tokens: ( ) identifiers numbers strings
 *   - WAT keywords: module, signal, component, export, func, etc.
 *   - Embedded HTML within component bodies: <div>, <span>, etc.
 *   - Reactive expressions inside {}: {get $count}, {set $count ...}
 */

export const TokenType = {
  // S-expression tokens
  LPAREN: 'LPAREN',           // (
  RPAREN: 'RPAREN',           // )

  // Literals
  IDENTIFIER: 'IDENTIFIER',   // module, signal, div, etc.
  DOLLAR_ID: 'DOLLAR_ID',     // $count, $Counter, etc.
  NUMBER: 'NUMBER',            // 0, 42, 3.14
  STRING: 'STRING',            // "hello"
  KEYWORD: 'KEYWORD',         // i32, i64, f32, f64

  // HTML tokens
  HTML_OPEN_TAG: 'HTML_OPEN_TAG',       // <div
  HTML_CLOSE_TAG: 'HTML_CLOSE_TAG',     // </div>
  HTML_SELF_CLOSE: 'HTML_SELF_CLOSE',   // />
  HTML_TAG_END: 'HTML_TAG_END',         // >
  HTML_ATTR_NAME: 'HTML_ATTR_NAME',     // onClick, class, etc.
  HTML_ATTR_EQ: 'HTML_ATTR_EQ',         // =
  HTML_TEXT: 'HTML_TEXT',               // text content between tags

  // Reactive expression tokens (inside {})
  LBRACE: 'LBRACE',           // {
  RBRACE: 'RBRACE',           // }

  // Special
  EOF: 'EOF',
  COMMENT: 'COMMENT',         // ;; line comment or (; block comment ;)
};

// WAT type keywords
const TYPE_KEYWORDS = new Set([
  'i32', 'i64', 'f32', 'f64',
  'i32.add', 'i32.sub', 'i32.mul', 'i32.div_s', 'i32.div_u',
  'i32.rem_s', 'i32.rem_u', 'i32.and', 'i32.or', 'i32.xor',
  'i32.shl', 'i32.shr_s', 'i32.shr_u',
  'i32.eq', 'i32.ne', 'i32.lt_s', 'i32.gt_s', 'i32.le_s', 'i32.ge_s',
  'i32.const', 'i32.eqz',
  'i64.add', 'i64.sub', 'i64.mul', 'i64.const',
  'f32.add', 'f32.sub', 'f32.mul', 'f32.div', 'f32.const',
  'f64.add', 'f64.sub', 'f64.mul', 'f64.div', 'f64.const',
]);

// WATX-specific keywords
const WATX_KEYWORDS = new Set([
  'module', 'signal', 'component', 'export', 'import',
  'func', 'param', 'result', 'local', 'call',
  'get', 'set', 'effect', 'memo', 'computed',
  'if', 'else', 'loop', 'block', 'br', 'br_if', 'return',
  'for', 'each', 'when', 'match',
]);

export class Token {
  constructor(type, value, line, col) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.col = col;
  }

  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.value)}, ${this.line}:${this.col})`;
  }
}

export class LexerError extends Error {
  constructor(message, line, col) {
    super(`Lexer error at ${line}:${col}: ${message}`);
    this.line = line;
    this.col = col;
  }
}

export class Lexer {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.mode = 'sexp'; // 'sexp' | 'html' | 'html_attr'
    this.htmlDepth = 0;
    this.braceDepth = 0;
  }

  peek() {
    if (this.pos >= this.source.length) return null;
    return this.source[this.pos];
  }

  peekAhead(n = 1) {
    const idx = this.pos + n;
    if (idx >= this.source.length) return null;
    return this.source[idx];
  }

  advance() {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  skipWhitespace() {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.advance();
    }
  }

  skipLineComment() {
    // ;; line comment
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.advance();
    }
  }

  skipBlockComment() {
    // (; ... ;)
    let depth = 1;
    this.advance(); // skip (
    this.advance(); // skip ;
    while (this.pos < this.source.length && depth > 0) {
      if (this.source[this.pos] === '(' && this.peekAhead() === ';') {
        depth++;
        this.advance();
        this.advance();
      } else if (this.source[this.pos] === ';' && this.peekAhead() === ')') {
        depth--;
        this.advance();
        this.advance();
      } else {
        this.advance();
      }
    }
  }

  makeToken(type, value) {
    return new Token(type, value, this.line, this.col);
  }

  readString() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip opening "
    let str = '';
    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      if (this.source[this.pos] === '\\') {
        this.advance();
        const escaped = this.advance();
        switch (escaped) {
          case 'n': str += '\n'; break;
          case 't': str += '\t'; break;
          case '\\': str += '\\'; break;
          case '"': str += '"'; break;
          default: str += escaped;
        }
      } else {
        str += this.advance();
      }
    }
    if (this.pos >= this.source.length) {
      throw new LexerError('Unterminated string', startLine, startCol);
    }
    this.advance(); // skip closing "
    return new Token(TokenType.STRING, str, startLine, startCol);
  }

  readNumber() {
    const startLine = this.line;
    const startCol = this.col;
    let num = '';
    if (this.source[this.pos] === '-') {
      num += this.advance();
    }
    while (this.pos < this.source.length && /[0-9.]/.test(this.source[this.pos])) {
      num += this.advance();
    }
    return new Token(TokenType.NUMBER, num, startLine, startCol);
  }

  readIdentifier() {
    const startLine = this.line;
    const startCol = this.col;
    let id = '';
    while (this.pos < this.source.length && /[a-zA-Z0-9_.\-]/.test(this.source[this.pos])) {
      id += this.advance();
    }

    if (TYPE_KEYWORDS.has(id)) {
      return new Token(TokenType.KEYWORD, id, startLine, startCol);
    }
    return new Token(TokenType.IDENTIFIER, id, startLine, startCol);
  }

  readDollarId() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip $
    let id = '$';
    while (this.pos < this.source.length && /[a-zA-Z0-9_\-]/.test(this.source[this.pos])) {
      id += this.advance();
    }
    return new Token(TokenType.DOLLAR_ID, id, startLine, startCol);
  }

  /**
   * Check if we're about to enter an HTML region.
   * HTML starts with < followed by a letter (opening tag) or / (closing tag).
   */
  isHtmlStart() {
    if (this.source[this.pos] !== '<') return false;
    const next = this.peekAhead();
    return next && (/[a-zA-Z]/.test(next) || next === '/');
  }

  /**
   * Read an HTML opening tag name: <tagName
   */
  readHtmlOpenTag() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip <
    let tagName = '';
    while (this.pos < this.source.length && /[a-zA-Z0-9\-]/.test(this.source[this.pos])) {
      tagName += this.advance();
    }
    this.mode = 'html_attr';
    return new Token(TokenType.HTML_OPEN_TAG, tagName, startLine, startCol);
  }

  /**
   * Read an HTML closing tag: </tagName>
   */
  readHtmlCloseTag() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip <
    this.advance(); // skip /
    let tagName = '';
    while (this.pos < this.source.length && /[a-zA-Z0-9\-]/.test(this.source[this.pos])) {
      tagName += this.advance();
    }
    this.skipWhitespace();
    if (this.source[this.pos] === '>') {
      this.advance(); // skip >
    }
    this.htmlDepth--;
    if (this.htmlDepth <= 0) {
      this.htmlDepth = 0;
      this.mode = 'sexp';
    }
    return new Token(TokenType.HTML_CLOSE_TAG, tagName, startLine, startCol);
  }

  /**
   * Read HTML attributes and the end of the opening tag
   */
  readHtmlAttributes() {
    this.skipWhitespace();
    const ch = this.source[this.pos];

    if (ch === '>') {
      const startLine = this.line;
      const startCol = this.col;
      this.advance();
      this.htmlDepth++;
      this.mode = 'html';
      return new Token(TokenType.HTML_TAG_END, '>', startLine, startCol);
    }

    if (ch === '/' && this.peekAhead() === '>') {
      const startLine = this.line;
      const startCol = this.col;
      this.advance(); // /
      this.advance(); // >
      if (this.htmlDepth <= 0) {
        this.mode = 'sexp';
      } else {
        this.mode = 'html';
      }
      return new Token(TokenType.HTML_SELF_CLOSE, '/>', startLine, startCol);
    }

    if (ch === '{') {
      return this.readReactiveBrace();
    }

    // Attribute name
    if (/[a-zA-Z]/.test(ch)) {
      const startLine = this.line;
      const startCol = this.col;
      let name = '';
      while (this.pos < this.source.length && /[a-zA-Z0-9\-]/.test(this.source[this.pos])) {
        name += this.advance();
      }

      // Check for = sign
      this.skipWhitespace();
      if (this.source[this.pos] === '=') {
        this.tokens.push(new Token(TokenType.HTML_ATTR_NAME, name, startLine, startCol));
        const eqLine = this.line;
        const eqCol = this.col;
        this.advance(); // skip =
        this.tokens.push(new Token(TokenType.HTML_ATTR_EQ, '=', eqLine, eqCol));

        this.skipWhitespace();
        // Attribute value: either "string" or {expression}
        if (this.source[this.pos] === '"') {
          return this.readString();
        } else if (this.source[this.pos] === '{') {
          return this.readReactiveBrace();
        } else {
          throw new LexerError(
            `Expected " or { after attribute =, got '${this.source[this.pos]}'`,
            this.line, this.col
          );
        }
      }

      return new Token(TokenType.HTML_ATTR_NAME, name, startLine, startCol);
    }

    throw new LexerError(`Unexpected character in HTML attribute: '${ch}'`, this.line, this.col);
  }

  /**
   * Read a reactive expression brace { ... }
   * Contents are tokenized as S-expressions
   */
  readReactiveBrace() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip {
    this.tokens.push(new Token(TokenType.LBRACE, '{', startLine, startCol));

    // Now read S-expression tokens until matching }
    let depth = 1;
    while (this.pos < this.source.length && depth > 0) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];

      if (ch === '}') {
        depth--;
        if (depth === 0) {
          const endLine = this.line;
          const endCol = this.col;
          this.advance();
          return new Token(TokenType.RBRACE, '}', endLine, endCol);
        }
      }

      if (ch === '{') {
        depth++;
        const bLine = this.line;
        const bCol = this.col;
        this.advance();
        this.tokens.push(new Token(TokenType.LBRACE, '{', bLine, bCol));
        continue;
      }

      // Tokenize S-expression content inside braces
      const token = this.readSexpToken();
      if (token) {
        this.tokens.push(token);
      }
    }

    throw new LexerError('Unterminated reactive expression', startLine, startCol);
  }

  /**
   * Read HTML text content (between tags, outside of {})
   */
  readHtmlText() {
    const startLine = this.line;
    const startCol = this.col;
    let text = '';
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === '<' || ch === '{') break;
      text += this.advance();
    }
    text = text.trim();
    if (text.length > 0) {
      return new Token(TokenType.HTML_TEXT, text, startLine, startCol);
    }
    return null;
  }

  /**
   * Read a single S-expression token
   */
  readSexpToken() {
    this.skipWhitespace();
    if (this.pos >= this.source.length) return null;

    const ch = this.source[this.pos];
    const startLine = this.line;
    const startCol = this.col;

    // Comments
    if (ch === ';' && this.peekAhead() === ';') {
      this.skipLineComment();
      return null; // skip comment tokens
    }
    if (ch === '(' && this.peekAhead() === ';') {
      this.skipBlockComment();
      return null;
    }

    // Parens
    if (ch === '(') {
      this.advance();
      return new Token(TokenType.LPAREN, '(', startLine, startCol);
    }
    if (ch === ')') {
      this.advance();
      return new Token(TokenType.RPAREN, ')', startLine, startCol);
    }

    // String
    if (ch === '"') {
      return this.readString();
    }

    // Dollar identifier
    if (ch === '$') {
      return this.readDollarId();
    }

    // Number (including negative)
    if (/[0-9]/.test(ch) || (ch === '-' && this.peekAhead() && /[0-9]/.test(this.peekAhead()))) {
      return this.readNumber();
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      return this.readIdentifier();
    }

    throw new LexerError(`Unexpected character: '${ch}'`, startLine, startCol);
  }

  /**
   * Main tokenize method
   */
  tokenize() {
    this.tokens = [];

    while (this.pos < this.source.length) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) break;

      if (this.mode === 'sexp') {
        // Check for HTML start within S-expression context
        if (this.isHtmlStart()) {
          const ch2 = this.peekAhead();
          if (ch2 === '/') {
            const token = this.readHtmlCloseTag();
            this.tokens.push(token);
          } else {
            const token = this.readHtmlOpenTag();
            this.tokens.push(token);
          }
          continue;
        }

        const token = this.readSexpToken();
        if (token) {
          this.tokens.push(token);
        }
      } else if (this.mode === 'html_attr') {
        const token = this.readHtmlAttributes();
        if (token) {
          this.tokens.push(token);
        }
      } else if (this.mode === 'html') {
        // HTML body mode — read text, nested tags, and reactive expressions
        const ch = this.source[this.pos];

        if (ch === '<') {
          const next = this.peekAhead();
          if (next === '/') {
            const token = this.readHtmlCloseTag();
            this.tokens.push(token);
          } else if (next && /[a-zA-Z]/.test(next)) {
            const token = this.readHtmlOpenTag();
            this.tokens.push(token);
          } else {
            // Not a tag, treat as text
            const token = this.readHtmlText();
            if (token) this.tokens.push(token);
          }
          continue;
        }

        if (ch === '{') {
          const token = this.readReactiveBrace();
          if (token) this.tokens.push(token);
          continue;
        }

        // Text content
        const token = this.readHtmlText();
        if (token) this.tokens.push(token);
      }
    }

    this.tokens.push(new Token(TokenType.EOF, null, this.line, this.col));
    return this.tokens;
  }
}

/**
 * Convenience function to tokenize a WATX source string
 */
export function tokenize(source) {
  const lexer = new Lexer(source);
  return lexer.tokenize();
}
