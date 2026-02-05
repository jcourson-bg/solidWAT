/**
 * WATX Runtime — SolidJS-inspired fine-grained reactivity for WebAssembly
 *
 * This runtime provides:
 *   - Signals: reactive state backed by WASM globals
 *   - Effects: automatic subscriptions that re-run when dependencies change
 *   - Batching: coalesce multiple signal updates into a single DOM update
 *   - Fine-grained DOM: only the exact nodes that depend on changed signals update
 *
 * Key difference from SolidJS:
 *   Signal values live in WASM memory (i32/i64/f32/f64 globals)
 *   The JS layer is a thin reactive bridge between WASM state and the DOM
 *
 * Inspired by:
 *   - SolidJS (https://github.com/solidjs/solid)
 *   - Preact Signals
 *   - S.js
 */

/**
 * Creates a new WATX runtime instance
 */
export function createRuntime() {
  // ==========================================
  // Reactive System (SolidJS-style)
  // ==========================================

  let currentEffect = null;
  let batchDepth = 0;
  let pendingEffects = new Set();

  /**
   * Create a reactive signal backed by WASM getter/setter
   *
   * @param {Function} wasmGetter - Function that reads from WASM global
   * @param {Function} wasmSetter - Function that writes to WASM global
   * @param {*} initialValue - Initial value (already set in WASM)
   * @returns {[Function, Function]} - [getter, setter] pair
   */
  function createSignal(wasmGetter, wasmSetter, initialValue) {
    const subscribers = new Set();

    // Getter: reads from WASM and tracks dependencies
    function getter() {
      if (currentEffect) {
        subscribers.add(currentEffect);
      }
      return wasmGetter();
    }

    // Setter: writes to WASM and notifies subscribers
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

  /**
   * Create a reactive effect that auto-tracks signal dependencies
   * Re-runs whenever any signal it reads changes (SolidJS createEffect)
   *
   * @param {Function} fn - Effect function
   * @returns {Function} - Dispose function
   */
  function createEffect(fn) {
    const effect = {
      fn,
      deps: new Set(),
      execute() {
        // Clean up old subscriptions
        cleanup(effect);

        // Track new dependencies
        const prevEffect = currentEffect;
        currentEffect = effect;
        try {
          fn();
        } finally {
          currentEffect = prevEffect;
        }
      },
    };

    // Run immediately to capture initial dependencies
    effect.execute();

    return () => cleanup(effect);
  }

  /**
   * Create a memo (computed value) — like SolidJS createMemo
   *
   * @param {Function} fn - Computation function
   * @returns {Function} - Getter function
   */
  function createMemo(fn) {
    let cachedValue;
    let dirty = true;
    const subscribers = new Set();

    const effect = {
      fn: () => {
        dirty = true;
        notify(subscribers);
      },
      deps: new Set(),
      execute() {
        cleanup(effect);
        const prevEffect = currentEffect;
        currentEffect = effect;
        try {
          cachedValue = fn();
          dirty = false;
        } finally {
          currentEffect = prevEffect;
        }
      },
    };

    // Initial computation
    effect.execute();

    function getter() {
      if (currentEffect) {
        subscribers.add(currentEffect);
      }
      if (dirty) {
        effect.execute();
      }
      return cachedValue;
    }

    return getter;
  }

  /**
   * Batch multiple signal updates — effects only run once at the end
   *
   * @param {Function} fn - Function that updates signals
   */
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

  /**
   * Notify subscribers of a signal change
   */
  function notify(subscribers) {
    for (const effect of subscribers) {
      if (batchDepth > 0) {
        pendingEffects.add(effect);
      } else {
        effect.execute();
      }
    }
  }

  /**
   * Run all pending effects (after a batch completes)
   */
  function runPendingEffects() {
    const effects = [...pendingEffects];
    pendingEffects.clear();
    for (const effect of effects) {
      effect.execute();
    }
  }

  /**
   * Clean up an effect's subscriptions
   */
  function cleanup(effect) {
    // Effect tracking is implicit through the signal subscriber sets
    // In a full implementation we'd track which signals each effect depends on
  }

  // ==========================================
  // DOM Helpers
  // ==========================================

  /**
   * Create an HTML element
   */
  function h(tag) {
    return document.createElement(tag);
  }

  /**
   * Create a text node
   */
  function text(content) {
    return document.createTextNode(content);
  }

  /**
   * Mount a component render function into a DOM container
   *
   * @param {Function} renderFn - Component render function
   * @param {HTMLElement|string} container - DOM element or selector
   */
  function mount(renderFn, container) {
    const target = typeof container === 'string'
      ? document.querySelector(container)
      : container;

    if (!target) {
      throw new Error(`WATX mount: container not found: ${container}`);
    }

    const el = renderFn();
    target.appendChild(el);
    return el;
  }

  return {
    createSignal,
    createEffect,
    createMemo,
    batch,
    h,
    text,
    mount,
  };
}
