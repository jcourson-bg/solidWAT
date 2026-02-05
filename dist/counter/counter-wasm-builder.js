/**
 * WATX Inline WASM Builder
 * Constructs a WASM binary module for signal state management.
 * Generated because wat2wasm was not available at build time.
 */

export function buildWasmModule() {
  const signals = [
  {
    "name": "$count",
    "type": "i32",
    "init": 0
  }
];

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
    0x00, 0x61, 0x73, 0x6D, // magic: \0asm
    0x01, 0x00, 0x00, 0x00, // version: 1
    ...typeSection,
    ...funcSection,
    ...globalSection,
    ...exportSection,
    ...codeSection,
  ]);

  return module.buffer;
}
