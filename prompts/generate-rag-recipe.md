You are converting one existing source/config file from a team's codebase into a **reusable-component recipe** for
an internal library other engineers' AI-generated test code will discover and call — not summarize or document in
the abstract, but produce a precise, machine-parseable file another tool will load and inject into future prompts.

Output ONLY the recipe file's exact final content — no commentary before or after it, no explanation of what you
did, and do not wrap the whole file in an outer fence (fenced code blocks belong ONLY around the example code
snippet(s) inside the body, exactly as shown in the format below).

## Required output format (follow exactly)

```
---
id: <lowercase-kebab-case-id, derived from what the component DOES, e.g. "postgres-query-and-validate">
title: <one plain-English sentence describing what this component does>
tags: [<3-8 lowercase keywords a future scenario description would plausibly use to find this>]
automationMode: [<one or both of: ui, api — which SoftPlay automation mode(s) this is relevant to>]
language: [<one or both of: java, python — which target test-generation language(s) this applies to; infer from
  the file's own syntax if it's Java/Python source, or from its evident usage context if it's a config/data file
  (e.g. a Spring .properties file implies java; a file used by both stacks implies both)>]
imports:
  java: [<fully-qualified Java import(s) needed to call this, if any — omit this key entirely if not applicable>]
  python: [<Python import path(s) needed to call this, if any — omit this key entirely if not applicable>]
---

<1-3 sentences: what this component does and when another engineer's generated test should reach for it instead
of writing new code.>

​```<language, e.g. java or python or yaml>
<the reusable code/config itself, cleaned up — see the rules below>
​```
```

## Rules for the code/config you include in the body

1. **Never reproduce a real secret.** If the source file contains an actual password, API key, connection string
   with embedded credentials, token, or any other credential-shaped value, you MUST replace it with either an
   environment-variable reference in that language's own idiom (e.g. `System.getenv("DB_PASSWORD")`,
   `os.environ["DB_PASSWORD"]`) or an obvious placeholder in angle brackets (e.g. `<DB_PASSWORD>`) — never the
   literal value. This file will be committed to source control and resent to an LLM on every future code
   generation; a real secret must never end up inside it.
2. **Keep it minimal and focused.** Include only the reusable part (the helper method, the connection/config
   pattern) — strip surrounding test-specific noise (unrelated imports, an unrelated class the method happened to
   live in, commented-out old code) that isn't part of the reusable component itself.
3. **Preserve the exact real API** — method names, parameter order/types, and package/module path must exactly
   match the source file, character for character, since this is what a future prompt will tell another model to
   call verbatim. Do not rename anything, "improve" the signature, or invent a method that doesn't exist in the
   source.
4. If the source file has no natural "import" concept (a YAML/properties/config file, a shell script), omit the
   `imports` key for that language entirely and instead explain in the description how the file/config should be
   referenced or loaded.

## The source file to convert

Its filename and full content follow this instruction. Analyze it, then output ONLY the recipe file per the format
above.
