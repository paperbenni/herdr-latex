These are development-only snapshots of the declarations written by Herdr 0.1.12
(gpui-shell 0.7.1) into `~/.config/herdr-app/`. They describe the native runtime;
Node mocks do not replace their types. They are committed so CI needs no desktop
installation. Do not install these snapshots as mod files.

To update after upgrading Herdr:

```sh
uv run python scripts/update_api_types.py
just check
just check-native
```

The script applies one generator compatibility correction: the runtime method
`Context.new(...)` is quoted as `Context."new"(...)`, so TypeScript interprets it
as a method instead of a constructor signature. Otherwise snapshots are verbatim.
`skipLibCheck` skips diagnostics inside these generated declarations; calls in our
sources still use their actual types. `strictPropertyInitialization` is disabled
because GPUI initializes Views through `init`, not constructors. All other strict
TypeScript checks are enabled.
