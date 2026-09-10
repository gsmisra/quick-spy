---
id: readme-top-level-project-note
title: Read the repository’s top-level README file as a lightweight project descriptor.
tags:
  - readme
  - documentation
  - project-metadata
  - repository-root
  - bootstrap
automationMode:
  - ui
  - api
language:
  - java
  - python
sourcePath: README.md
sourceHash: 0380f92ee3b279f6f3591d9af96cb8a6c2f1eb042b4dffbde1ebd229f2f4ddad
sourceHashScheme: sha256-raw-v1
sourceMapped: true
---

Use: Use this when generated tests need to reference the repository’s canonical top-level documentation file instead of creating ad-hoc metadata notes.
Requires: The test/runtime must have filesystem access to the project root where `README.md` exists.
API: Reference the whole-file capability via `README.md`.

```python
open("README.md", "r", encoding="utf-8").read()
```
