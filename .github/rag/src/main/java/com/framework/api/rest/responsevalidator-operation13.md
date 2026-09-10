---
id: operation13-response-validator-call
title: Invoke ResponseValidator.operation13 to trigger its built-in operation-level validation/logging hook.
tags:
  - api
  - rest
  - response
  - validator
  - method-call
  - diagnostics
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation13
sourceHash: 48d71f56cb7540910debee49913c153765f330cce7eb1abc73b8a130eeec3c73
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to explicitly invoke the existing `ResponseValidator` operation13 behavior instead of adding custom helper logic.
Requires: A `ResponseValidator` instance is already available in scope.
API: public void operation13()

```java
responseValidator.operation13();
```
