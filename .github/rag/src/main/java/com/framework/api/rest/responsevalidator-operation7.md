---
id: response-validator-operation7-invoke
title: Invoke ResponseValidator.operation7 to execute the existing operation7 capability.
tags:
  - responsevalidator
  - rest
  - api
  - operation7
  - invocation
  - validation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation7
sourceHash: f7746812e38b1e5fbe0c220464840a4da7153c88c419567061ae64731789454d
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test should trigger the built-in `operation7` behavior on `ResponseValidator` rather than creating a new wrapper.
Requires: An initialized `ResponseValidator` instance in scope.
API: public void operation7()

```java
responseValidator.operation7();
```
