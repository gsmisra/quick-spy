---
id: operation14-invoke-api-test-data-builder
title: Invoke `operation14` on `ApiTestDataBuilder` to run its built-in operation hook.
tags:
  - api
  - rest
  - builder
  - method-call
  - diagnostics
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ApiTestDataBuilder
sourcePath: src/main/java/com/framework/api/rest/ApiTestDataBuilder.java#operation14
sourceHash: 40c7be296561c0754e385534e2a1c7c91b4efa6532c9be72ae5b8b8666a611f7
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the existing `ApiTestDataBuilder` operation hook rather than adding a new helper method.
Requires: An initialized `ApiTestDataBuilder` instance in scope.
API: public void operation14()

```java
apiTestDataBuilder.operation14();
```
