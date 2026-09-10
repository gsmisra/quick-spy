---
id: operation11-validator-trace
title: Calls ResponseValidator.operation11 to trigger its built-in operation11 validation trace output.
tags:
  - responsevalidator
  - api
  - validation
  - logging
  - operation11
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation11
sourceHash: 6023901dafb59f86275597c9e55c9094376212de71b4f63b39bd0f3a9a365f94
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the predefined operation11 validator hook instead of adding custom trace or placeholder logic.
Requires: An initialized `ResponseValidator` instance in scope.
API: `public void operation11()`

```java
responseValidator.operation11();
```
