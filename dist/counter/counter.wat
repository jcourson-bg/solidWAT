(module
  (global $count (mut i32) (i32.const 0))

  (func $signal_get_count (result i32)
    (global.get $count)
  )
  (func $signal_set_count (param $value i32)
    (global.set $count (local.get $value))
  )

  (export "signal_get_count" (func $signal_get_count))
  (export "signal_set_count" (func $signal_set_count))
)