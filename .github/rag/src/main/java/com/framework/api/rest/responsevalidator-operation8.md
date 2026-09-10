---
id: responsevalidator-operation8-invocation
title: Call `operation8` on `ResponseValidator` to execute this validator operation entrypoint.
tags:
  - api
  - response
  - validator
  - operation8
  - java
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.ResponseValidator
sourcePath: src/main/java/com/framework/api/rest/ResponseValidator.java#operation8
sourceHash: 85db379a9a894a7d4f34ba08a63a5c259403573939debb4646a418e3ab3b7123
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the `ResponseValidator` operation directly rather than creating a new helper path.
Requires: A `ResponseValidator` instance must already be available to call this instance method.
API: public void operation8()

```java
new ResponseValidator().operation8();
```
