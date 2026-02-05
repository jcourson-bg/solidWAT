/**
 * Runtime tests — validate the SolidJS-inspired reactive system
 *
 * These tests simulate what happens in the browser:
 *   - WASM-backed signals (using plain JS vars as mock WASM globals)
 *   - Automatic dependency tracking
 *   - Fine-grained effect re-execution
 *   - Batched updates
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// We can't import the runtime directly since it uses `document`,
// so we'll inline the core reactive logic for testing.
// This validates the algorithm, not the DOM parts.

function createReactiveSystem() {
  let currentEffect = null;
  let batchDepth = 0;
  let pendingEffects = new Set();

  function createSignal(wasmGetter, wasmSetter, initialValue) {
    const subscribers = new Set();

    function getter() {
      if (currentEffect) {
        subscribers.add(currentEffect);
      }
      return wasmGetter();
    }

    function setter(valueOrFn) {
      const oldValue = wasmGetter();
      let newValue;
      if (typeof valueOrFn === 'function') {
        newValue = valueOrFn(oldValue);
      } else {
        newValue = valueOrFn;
      }
      if (oldValue !== newValue) {
        wasmSetter(newValue);
        notify(subscribers);
      }
    }

    return [getter, setter];
  }

  function createEffect(fn) {
    const effect = {
      fn,
      execute() {
        const prevEffect = currentEffect;
        currentEffect = effect;
        try {
          fn();
        } finally {
          currentEffect = prevEffect;
        }
      },
    };
    effect.execute();
    return () => {};
  }

  function createMemo(fn) {
    let cachedValue;
    let dirty = true;
    const subscribers = new Set();

    const effect = {
      execute() {
        const prevEffect = currentEffect;
        currentEffect = effect;
        try {
          cachedValue = fn();
          dirty = false;
        } finally {
          currentEffect = prevEffect;
        }
        // Notify memo subscribers
        for (const sub of subscribers) {
          if (batchDepth > 0) {
            pendingEffects.add(sub);
          } else {
            sub.execute();
          }
        }
      },
    };

    // Wire up: when upstream signals change, mark dirty and re-compute
    const origExecute = effect.execute.bind(effect);
    effect.execute = () => {
      dirty = true;
      origExecute();
    };

    effect.execute();

    function getter() {
      if (currentEffect) {
        subscribers.add(currentEffect);
      }
      return cachedValue;
    }

    return getter;
  }

  function batch(fn) {
    batchDepth++;
    try {
      fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) {
        runPendingEffects();
      }
    }
  }

  function notify(subscribers) {
    for (const effect of subscribers) {
      if (batchDepth > 0) {
        pendingEffects.add(effect);
      } else {
        effect.execute();
      }
    }
  }

  function runPendingEffects() {
    const effects = [...pendingEffects];
    pendingEffects.clear();
    for (const effect of effects) {
      effect.execute();
    }
  }

  return { createSignal, createEffect, createMemo, batch };
}

// Mock WASM-like global storage
function mockWasmGlobal(initialValue) {
  let value = initialValue;
  return {
    get: () => value,
    set: (v) => { value = v; },
  };
}

describe('Reactive System', () => {
  let sys;

  beforeEach(() => {
    sys = createReactiveSystem();
  });

  describe('createSignal', () => {
    it('should create a signal with initial value', () => {
      const wasm = mockWasmGlobal(0);
      const [count] = sys.createSignal(wasm.get, wasm.set, 0);
      assert.equal(count(), 0);
    });

    it('should update signal value', () => {
      const wasm = mockWasmGlobal(0);
      const [count, setCount] = sys.createSignal(wasm.get, wasm.set, 0);
      setCount(42);
      assert.equal(count(), 42);
    });

    it('should support functional updates', () => {
      const wasm = mockWasmGlobal(10);
      const [count, setCount] = sys.createSignal(wasm.get, wasm.set, 10);
      setCount(v => v + 5);
      assert.equal(count(), 15);
    });

    it('should not notify if value unchanged', () => {
      const wasm = mockWasmGlobal(5);
      const [count, setCount] = sys.createSignal(wasm.get, wasm.set, 5);
      let effectRuns = 0;
      sys.createEffect(() => {
        count(); // subscribe
        effectRuns++;
      });
      assert.equal(effectRuns, 1); // initial run
      setCount(5); // same value
      assert.equal(effectRuns, 1); // no re-run
    });

    it('should write through to WASM global', () => {
      const wasm = mockWasmGlobal(0);
      const [, setCount] = sys.createSignal(wasm.get, wasm.set, 0);
      setCount(99);
      assert.equal(wasm.get(), 99); // WASM global updated
    });
  });

  describe('createEffect', () => {
    it('should run immediately', () => {
      let ran = false;
      sys.createEffect(() => { ran = true; });
      assert.ok(ran);
    });

    it('should auto-track signal dependencies', () => {
      const wasm = mockWasmGlobal(0);
      const [count, setCount] = sys.createSignal(wasm.get, wasm.set, 0);
      let observed = -1;
      sys.createEffect(() => {
        observed = count();
      });
      assert.equal(observed, 0);
      setCount(7);
      assert.equal(observed, 7);
      setCount(13);
      assert.equal(observed, 13);
    });

    it('should track multiple signals', () => {
      const wasmA = mockWasmGlobal(1);
      const wasmB = mockWasmGlobal(2);
      const [a, setA] = sys.createSignal(wasmA.get, wasmA.set, 1);
      const [b, setB] = sys.createSignal(wasmB.get, wasmB.set, 2);

      let sum = 0;
      sys.createEffect(() => {
        sum = a() + b();
      });
      assert.equal(sum, 3);

      setA(10);
      assert.equal(sum, 12);

      setB(20);
      assert.equal(sum, 30);
    });

    it('should handle the counter increment pattern', () => {
      // This simulates: onClick={set $count (i32.add (get $count) (i32.const 1))}
      const wasm = mockWasmGlobal(0);
      const [count, setCount] = sys.createSignal(wasm.get, wasm.set, 0);

      let displayed = '';
      sys.createEffect(() => {
        displayed = String(count());
      });
      assert.equal(displayed, '0');

      // Simulate click: set_count(count() + 1)
      setCount(count() + 1);
      assert.equal(displayed, '1');
      assert.equal(wasm.get(), 1);

      setCount(count() + 1);
      assert.equal(displayed, '2');

      // Decrement
      setCount(count() - 1);
      assert.equal(displayed, '1');
    });
  });

  describe('batch', () => {
    it('should coalesce multiple updates', () => {
      const wasm = mockWasmGlobal(0);
      const [count, setCount] = sys.createSignal(wasm.get, wasm.set, 0);
      let effectRuns = 0;
      sys.createEffect(() => {
        count();
        effectRuns++;
      });
      assert.equal(effectRuns, 1);

      sys.batch(() => {
        setCount(1);
        setCount(2);
        setCount(3);
      });

      // Effect should only run once after batch, not 3 times
      // (it runs once for the batch completion)
      assert.equal(effectRuns, 2);
      assert.equal(count(), 3);
    });

    it('should work with multiple signals', () => {
      const wasmA = mockWasmGlobal(0);
      const wasmB = mockWasmGlobal(0);
      const [a, setA] = sys.createSignal(wasmA.get, wasmA.set, 0);
      const [b, setB] = sys.createSignal(wasmB.get, wasmB.set, 0);

      let log = [];
      sys.createEffect(() => {
        log.push(`a=${a()},b=${b()}`);
      });
      assert.deepEqual(log, ['a=0,b=0']);

      sys.batch(() => {
        setA(1);
        setB(2);
      });

      // Should see one combined update, not two separate ones
      assert.equal(log.length, 2); // initial + one batch update
      assert.equal(log[1], 'a=1,b=2');
    });
  });

  describe('createMemo', () => {
    it('should compute derived value', () => {
      const wasm = mockWasmGlobal(5);
      const [count] = sys.createSignal(wasm.get, wasm.set, 5);
      const doubled = sys.createMemo(() => count() * 2);
      assert.equal(doubled(), 10);
    });

    it('should update when source signal changes', () => {
      const wasm = mockWasmGlobal(3);
      const [count, setCount] = sys.createSignal(wasm.get, wasm.set, 3);
      const doubled = sys.createMemo(() => count() * 2);

      assert.equal(doubled(), 6);
      setCount(10);
      assert.equal(doubled(), 20);
    });

    it('should work in effects', () => {
      const wasm = mockWasmGlobal(4);
      const [count, setCount] = sys.createSignal(wasm.get, wasm.set, 4);
      const doubled = sys.createMemo(() => count() * 2);

      let observed = -1;
      sys.createEffect(() => {
        observed = doubled();
      });
      assert.equal(observed, 8);

      setCount(7);
      assert.equal(observed, 14);
    });
  });

  describe('WASM Integration Pattern', () => {
    it('should simulate full counter app lifecycle', () => {
      // Simulate what the generated code does:
      // 1. WASM module provides signal_get_count / signal_set_count
      // 2. Runtime creates reactive wrappers
      // 3. Component creates DOM with reactive bindings

      const wasmGlobal = { count: 0 };
      const wasm = {
        signal_get_count: () => wasmGlobal.count,
        signal_set_count: (v) => { wasmGlobal.count = v; },
      };

      const [count, set_count] = sys.createSignal(
        () => wasm.signal_get_count(),
        (v) => wasm.signal_set_count(v),
        0
      );

      // Simulate reactive text node
      let textContent = '';
      sys.createEffect(() => {
        textContent = String(count());
      });

      assert.equal(textContent, '0');

      // Simulate + button click: set $count (i32.add (get $count) (i32.const 1))
      set_count(count() + 1);
      assert.equal(textContent, '1');
      assert.equal(wasmGlobal.count, 1); // WASM state updated

      // Click 5 more times
      for (let i = 0; i < 5; i++) {
        set_count(count() + 1);
      }
      assert.equal(textContent, '6');
      assert.equal(wasmGlobal.count, 6);

      // Simulate - button click: set $count (i32.sub (get $count) (i32.const 1))
      set_count(count() - 1);
      assert.equal(textContent, '5');
      assert.equal(wasmGlobal.count, 5);
    });
  });
});
