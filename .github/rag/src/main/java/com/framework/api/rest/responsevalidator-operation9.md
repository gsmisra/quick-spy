---
id: operation9-responsevalidator-invoke
title: Invoke `operation9` on `ResponseValidator` during an API test flow.
tags:
  - responsevalidator
  - api
  - method-call
  - java
  - validation
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation9
sourceHash: 2e02d7e9b5dcfe86a2e3ad4dc6f1a3c35cda13225acdf901253683f75d2b373d
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger the `ResponseValidator` `operation9` capability directly instead of adding helper code.

Requires: An already-created `ResponseValidator` instance in scope.

API: `public void operation9()`

```java
responseValidator.operation9();
```
