---
id: response-validator-operation15-call
title: Calls the `operation15` method on `ResponseValidator`.
tags:
  - response
  - validator
  - api
  - method-call
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation15
sourceHash: 86840a89f71df97482a2f5bf3fb7672c5c2db0020c9e0b90b5f0d2488ef01e82
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `ResponseValidator` capability directly rather than adding a new helper.
Requires: A `ResponseValidator` instance available to call.  
API: public void operation15()

```java
new ResponseValidator().operation15();
```
