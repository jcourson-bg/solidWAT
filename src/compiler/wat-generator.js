/**
 * WAT Generator — Compiles WATX AST to WebAssembly Text Format
 *
 * Generates WAT code for:
 *   - Signal storage as WASM globals
 *   - Getter/setter functions exported for JS bridge
 *   - Arithmetic and logic operations as native WASM
 *   - Custom functions
 *
 * Architecture:
 *   Each signal becomes a mutable WASM global.
 *   get/set operations compile to global.get/global.set.
 *   Arithmetic expressions compile to native WASM instructions.
 */

export class WatGenerator {
  constructor(ast) {
    this.ast = ast;
    this.signals = [];
    this.funcs = [];
    this.exports = [];
    this.indent = 0;
  }

  /**
   * Generate WAT source code from the AST
   */
  generate() {
    // Collect all signals, funcs, exports from module body
    for (const node of this.ast.body) {
      switch (node.type) {
        case 'Signal':
          this.signals.push(node);
          break;
        case 'Func':
          this.funcs.push(node);
          break;
        case 'Export':
          if (node.kind === 'func') {
            this.exports.push(node);
          }
          break;
      }
    }

    return this.emitModule();
  }

  /**
   * Get signal metadata for the JS generator
   */
  getSignalInfo() {
    return this.signals.map((s, i) => ({
      name: s.name,
      type: s.valueType,
      initialValue: s.initialValue?.value ?? 0,
      index: i,
      getterName: `signal_get_${s.name.slice(1)}`,
      setterName: `signal_set_${s.name.slice(1)}`,
    }));
  }

  emit(line) {
    return '  '.repeat(this.indent) + line;
  }

  emitModule() {
    const lines = [];
    lines.push('(module');
    this.indent++;

    // Emit globals for signals
    for (const signal of this.signals) {
      lines.push(this.emitSignalGlobal(signal));
    }

    if (this.signals.length > 0) lines.push('');

    // Emit getter/setter functions for each signal
    for (const signal of this.signals) {
      lines.push(...this.emitSignalAccessors(signal));
      lines.push('');
    }

    // Emit custom functions
    for (const func of this.funcs) {
      lines.push(...this.emitFunc(func));
      lines.push('');
    }

    // Emit exports for signal accessors
    for (const signal of this.signals) {
      const name = signal.name.slice(1); // remove $
      lines.push(this.emit(`(export "signal_get_${name}" (func $signal_get_${name}))`));
      lines.push(this.emit(`(export "signal_set_${name}" (func $signal_set_${name}))`));
    }

    // Emit user-specified function exports
    for (const exp of this.exports) {
      const name = exp.ref.slice(1);
      lines.push(this.emit(`(export "${exp.exportName}" (func $${name}))`));
    }

    this.indent--;
    lines.push(')');
    return lines.join('\n');
  }

  emitSignalGlobal(signal) {
    const name = signal.name;
    const type = signal.valueType;
    const init = signal.initialValue?.value ?? 0;
    return this.emit(`(global ${name} (mut ${type}) (${type}.const ${init}))`);
  }

  emitSignalAccessors(signal) {
    const lines = [];
    const name = signal.name.slice(1);
    const type = signal.valueType;

    // Getter: () -> type
    lines.push(this.emit(`(func $signal_get_${name} (result ${type})`));
    this.indent++;
    lines.push(this.emit(`(global.get $${name})`));
    this.indent--;
    lines.push(this.emit(')'));

    // Setter: (type) -> void
    lines.push(this.emit(`(func $signal_set_${name} (param $value ${type})`));
    this.indent++;
    lines.push(this.emit(`(global.set $${name} (local.get $value))`));
    this.indent--;
    lines.push(this.emit(')'));

    return lines;
  }

  emitFunc(func) {
    const lines = [];
    let sig = `(func`;
    if (func.name) sig += ` ${func.name}`;

    for (const param of func.params) {
      sig += ` (param`;
      if (param.name) sig += ` ${param.name}`;
      sig += ` ${param.type})`;
    }

    for (const result of func.results) {
      sig += ` (result ${result})`;
    }

    lines.push(this.emit(sig));
    this.indent++;

    for (const expr of func.body) {
      lines.push(...this.emitExpr(expr));
    }

    this.indent--;
    lines.push(this.emit(')'));
    return lines;
  }

  emitExpr(node) {
    const lines = [];

    switch (node.type) {
      case 'SExpr': {
        // Handle get/set as global.get/global.set
        if (node.op === 'get' && node.args.length === 1 && node.args[0].type === 'DollarId') {
          lines.push(this.emit(`(global.get ${node.args[0].name})`));
          return lines;
        }

        if (node.op === 'set' && node.args.length >= 2) {
          const target = node.args[0];
          const value = node.args[1];
          const valueLines = this.emitExpr(value);
          lines.push(this.emit(`(global.set ${target.name}`));
          this.indent++;
          lines.push(...valueLines);
          this.indent--;
          lines.push(this.emit(')'));
          return lines;
        }

        // Handle WAT instructions like i32.add, i32.const, etc.
        if (node.op && node.args.length === 0) {
          lines.push(this.emit(`(${node.op})`));
          return lines;
        }

        if (node.op) {
          lines.push(this.emit(`(${node.op}`));
          this.indent++;
          for (const arg of node.args) {
            lines.push(...this.emitExpr(arg));
          }
          this.indent--;
          lines.push(this.emit(')'));
          return lines;
        }

        break;
      }

      case 'NumberLiteral':
        lines.push(this.emit(`${node.raw}`));
        return lines;

      case 'DollarId':
        lines.push(this.emit(`${node.name}`));
        return lines;

      case 'Identifier':
        lines.push(this.emit(`${node.name}`));
        return lines;

      case 'StringLiteral':
        lines.push(this.emit(`"${node.value}"`));
        return lines;
    }

    return lines;
  }

  /**
   * Compile an S-expression to a flat WAT instruction for use in event handlers.
   * Returns a representation the JS generator can use.
   */
  compileReactiveExpr(expr) {
    if (expr.type === 'SExpr') {
      if (expr.op === 'get' && expr.args.length === 1 && expr.args[0].type === 'DollarId') {
        const name = expr.args[0].name.slice(1);
        return { kind: 'signal_get', signal: name, fn: `signal_get_${name}` };
      }

      if (expr.op === 'set') {
        const target = expr.args[0];
        const targetName = target.name ? target.name.slice(1) : target.value?.slice(1);
        const valueExpr = expr.args.length > 1 ? expr.args[1] : null;
        return {
          kind: 'signal_set',
          signal: targetName,
          fn: `signal_set_${targetName}`,
          value: valueExpr ? this.compileReactiveExpr(valueExpr) : null,
        };
      }

      if (expr.op === 'call') {
        const funcName = expr.args[0]?.name?.slice(1) || expr.args[0]?.value;
        return {
          kind: 'call',
          fn: funcName,
          args: expr.args.slice(1).map(a => this.compileReactiveExpr(a)),
        };
      }

      // WAT arithmetic: i32.add, i32.sub, etc.
      if (expr.op && expr.op.includes('.')) {
        return {
          kind: 'wasm_op',
          op: expr.op,
          args: expr.args.map(a => this.compileReactiveExpr(a)),
        };
      }

      return {
        kind: 'sexpr',
        op: expr.op,
        args: expr.args.map(a => this.compileReactiveExpr(a)),
      };
    }

    if (expr.type === 'NumberLiteral') {
      return { kind: 'const', value: expr.value };
    }

    if (expr.type === 'DollarId') {
      return { kind: 'ref', name: expr.name };
    }

    if (expr.type === 'Identifier') {
      return { kind: 'ident', name: expr.name };
    }

    if (expr.type === 'StringLiteral') {
      return { kind: 'string', value: expr.value };
    }

    return { kind: 'unknown', node: expr };
  }
}
