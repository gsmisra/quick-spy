---
id: operation10-console-invocation
title: Calls ApiTestDataBuilder.operation10 to trigger its predefined operation-level console signal.
tags:
  - api
  - rest
  - testdata
  - builder
  - operation10
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation10
sourceHash: c4149ad898c4b27b012955fd121bdd9266e7b628619064d89fe15010749789d3
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the library’s built-in `operation10` step directly instead of adding custom helper code.
Requires: An available `ApiTestDataBuilder` instance in the current test flow.
API: public void operation10()

```java
apiTestDataBuilder.operation10();
```
