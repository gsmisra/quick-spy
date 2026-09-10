---
id: response-validator-operation10-invoke
title: Invoke ResponseValidator operation10 as a no-argument API-side validation step.
tags:
  - response
  - validator
  - api
  - method-call
  - smoke
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation10
sourceHash: ceb694d4a5b15f701e68c9b4f8a5959cc488e0bc26d23ea2fe3ca0070b67e574
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to explicitly trigger the `ResponseValidator` operation10 hook instead of adding custom helper code.
Requires: An initialized `ResponseValidator` instance in scope.
API: public void operation10()

```java
responseValidator.operation10();
```
