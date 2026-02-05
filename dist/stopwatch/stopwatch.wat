(module
  (global $seconds (mut i32) (i32.const 0))
  (global $running (mut i32) (i32.const 0))

  (func $signal_get_seconds (result i32)
    (global.get $seconds)
  )
  (func $signal_set_seconds (param $value i32)
    (global.set $seconds (local.get $value))
  )

  (func $signal_get_running (result i32)
    (global.get $running)
  )
  (func $signal_set_running (param $value i32)
    (global.set $running (local.get $value))
  )

  (export "signal_get_seconds" (func $signal_get_seconds))
  (export "signal_set_seconds" (func $signal_set_seconds))
  (export "signal_get_running" (func $signal_get_running))
  (export "signal_set_running" (func $signal_set_running))
)