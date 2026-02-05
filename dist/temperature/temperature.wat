(module
  (global $celsius (mut i32) (i32.const 0))
  (global $fahrenheit (mut i32) (i32.const 32))

  (func $signal_get_celsius (result i32)
    (global.get $celsius)
  )
  (func $signal_set_celsius (param $value i32)
    (global.set $celsius (local.get $value))
  )

  (func $signal_get_fahrenheit (result i32)
    (global.get $fahrenheit)
  )
  (func $signal_set_fahrenheit (param $value i32)
    (global.set $fahrenheit (local.get $value))
  )

  (export "signal_get_celsius" (func $signal_get_celsius))
  (export "signal_set_celsius" (func $signal_set_celsius))
  (export "signal_get_fahrenheit" (func $signal_get_fahrenheit))
  (export "signal_set_fahrenheit" (func $signal_set_fahrenheit))
)