---
id: response-validator-operation2
title: Invoke `operation2` on `ResponseValidator` to execute this API validation step.
tags:
  - api
  - rest
  - responsevalidator
  - validation
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation2
sourceHash: 4189e79d54aedbad1cd54434bdd6a1ac3d6430238c0175563da6f192140abbd2
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test should directly trigger the existing `ResponseValidator` operation rather than adding a new helper method.
Requires: A `ResponseValidator` instance is available in scope.
API: public void operation2()

```java
new ResponseValidator().operation2();
```
