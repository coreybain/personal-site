# `Home/Generated/` — codegen output. Do not hand-edit.

Swift `Codable` structs generated from the Zod schemas in `packages/types`.

## Why this directory is the reason `apps/ios` is in the monorepo at all

Xcode does not consume npm packages, and this app shares no code with
`apps/web`. What it shares is the **contract**. From the plan's monorepo-layout
note:

> `packages/types` holds Zod schemas as the source of truth; a Turbo task
> generates Swift `Codable` structs from them so the API contract cannot drift.

That is the entire justification for `apps/ios` living beside `apps/web` rather
than in its own repository. Every file in this directory is downstream of a Zod
schema; a field renamed in `packages/types/src/content.ts` becomes a Swift
compile error here rather than a `nil` at runtime in Sydney at 11pm.

## Rules

1. **Never edit a file in here.** The next generator run overwrites it, and the
   overwrite is silent.
2. **Fix the schema, not the output.** A wrong type here is a wrong type in
   `packages/types`, and fixing it there fixes the browser admin too.
3. Files here are picked up by the directory glob in `project.yml` like any
   other source. Run `xcodegen generate` after the first generation adds files,
   and after any run that adds or removes one.
4. The generated files **are committed**, for the same reason
   `packages/convex/convex/_generated` is: a fresh clone must build without
   first standing up a Node toolchain inside Xcode.

## Status

Empty. The generator task does not exist yet — it is a `packages/types` concern,
not an `apps/ios` one. Until it lands, hand-written `Decodable` types are
acceptable **only** inside a feature directory, and each one is a debt to repay
here.
