---
id: responsevalidator-execute-trigger
title: Triggers the ResponseValidator execution step.
tags:
  - response
  - validator
  - rest
  - api
  - execution
  - hook
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#execute
sourceHash: 5b1a2cd2bfbef7d054b149e68ddd5f14b9023564c36180cdf59e8acdfb0c8bf2
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to invoke the existing `ResponseValidator` execution point instead of adding custom execution code.
Requires: A `ResponseValidator` instance must already be available in scope.
API: public void execute()

```java
responseValidator.execute();
```
