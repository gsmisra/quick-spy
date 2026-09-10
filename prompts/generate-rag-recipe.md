You are converting ONE capability from a team's codebase into a compact, VERIFIABLE **calling contract** for an
internal library other engineers' AI-generated test code will discover and call — not a copy of how it works
internally, only how to CALL it. Output ONLY the recipe file's exact final content — no commentary before or after
it, and do not wrap the whole file in an outer fence (fences belong ONLY around the one invocation example inside
the body, exactly as shown in the format below).

## What you are given below

- **Capability name** — the exact method/function/config-unit name. Use it EXACTLY as given; never rename it.
- **Kind** — `method`, `constructor`, or `whole-file` (a config/data file with no single callable method).
- **Owner class** (if any) — the class this capability belongs to.
- **File's path within the uploaded project**, and — for Java — its own detected `package` declaration when found.
  This is ground truth; do not re-derive or second-guess it from anything else.
- **Signature** — the capability's own real signature line(s), verbatim from source.
- **Source excerpt** — the capability's own REAL body/content, given ONLY so you can understand what it does, its
  preconditions, and its return shape. **You must NEVER reproduce this excerpt, or a close paraphrase of its
  internal logic, in your output.** Your job is to describe how to CALL it — not to explain or restate how it
  works inside.

## Required output format (follow exactly)

```
---
id: <lowercase-kebab-case-id, derived from the capability name and what it does, e.g. "postgres-query-one">
title: <one plain-English sentence describing what this component does>
tags: [<3-8 lowercase keywords a future scenario description would plausibly use to find this>]
automationMode: [<one or both of: ui, api — which SoftPlay automation mode(s) this is relevant to>]
language: [<one or both of: java, python — which target test-generation language(s) this applies to>]
imports:
  java: [<fully-qualified Java import(s), verbatim from the ground truth given — omit this key entirely if not applicable>]
  python: [<Python import path(s) — see the import/package rule below; omit this key entirely if you can't establish one reliably>]
---

Use: <one sentence — when a test should reach for this instead of writing new code>
Requires: <preconditions/prerequisites a caller must already have in place before calling this — write "None." if
  the excerpt shows none>
API: <the exact signature, verbatim from what you were given above>

​```<language, e.g. java or python or yaml>
<ONE minimal, realistic invocation — a call to this exact capability using its real name and parameters, and
nothing else: no surrounding class, no test scaffolding, no assertions beyond what's needed to show the call>
​```
```

## Hard rules

1. **Never reproduce the implementation.** No copy of the source excerpt's body, no close paraphrase of its
   internal logic anywhere in your output — the "API" line and the one invocation example are the only code-shaped
   content allowed. If the excerpt is short enough that describing it accurately would essentially restate it,
   describe its EFFECT ("looks up a row by id and returns it") instead of its steps.
2. **Never invent an unobservable fact.** If the given excerpt doesn't actually show you a return type/shape, a
   thrown exception, or a precondition, do NOT guess, assume a "typical" shape, or invent one — describe only what
   the excerpt itself demonstrates. If you genuinely cannot write a usable, evidence-based contract from what
   you're given (the excerpt is too ambiguous, incomplete, or gives no observable behavior to describe), output
   EXACTLY this instead of the frontmatter block, and nothing else:
   `REVIEW NEEDED: <one short sentence explaining what's missing>`
3. **Never reproduce a real secret.** If the excerpt contains an actual password, API key, connection string with
   embedded credentials, token, or any other credential-shaped value, replace it with either an environment-
   variable reference in that language's own idiom (e.g. `System.getenv("DB_PASSWORD")`,
   `os.environ["DB_PASSWORD"]`) or an obvious placeholder in angle brackets (e.g. `<DB_PASSWORD>`) — never the
   literal value, even in the "Requires"/"Use" prose.
4. **Preserve the exact real API.** The name, parameter order/types, and package/module path in your "API" line and
   invocation example must exactly match what you were given, character for character. Do not rename anything,
   "improve" the signature, or invent a parameter/overload that isn't in the given signature.
5. **Import/package derivation — use the ground truth you're given, don't guess from a bare filename.**
   - **Java**: if a "Detected Java package declaration" is provided below, use it VERBATIM for the import — it is
     authoritative. If it's absent and the given path doesn't make the package obvious either, omit the `imports`
     key rather than inventing one.
   - **Python**: Python has no self-declared module path — it comes ONLY from the file's position under a real
     package root (a directory a project actually imports from, e.g. the one just above a top-level `src/`, or a
     directory containing an `__init__.py`), NOT from mechanically joining every folder in the given path with
     dots. A path like `some-project-1.2/src/myapp/db/client.py` implies `myapp.db.client` (root = `myapp`'s
     parent), not `some_project_1_2.src.myapp.db.client`. If you cannot establish a reliable path, omit the
     `imports.python` key and say so in the description rather than trusting a guess.
6. **Keep it short.** Target roughly 250–450 tokens total for the whole file. This is a compact, verifiable
   contract, not documentation — omit restating anything obvious, and don't pad the "Use"/"Requires" prose.
7. If `Kind` is `whole-file` (a config/data file, not a single callable), there is no method signature to give —
   write the "API" line as how the file/config is actually LOADED or REFERENCED instead (e.g. "load via
   `ConfigLoader.load('app.properties')`" if that's evident from context, or the file's own path/format if not),
   and the invocation example shows using it, not calling a method.

## The capability to convert

Its name, kind, owner class (if any), path within the project, detected package (if Java), real signature, and
source excerpt follow this instruction. Analyze it, then output ONLY the recipe file per the format above — or the
`REVIEW NEEDED:` line if you genuinely cannot.
