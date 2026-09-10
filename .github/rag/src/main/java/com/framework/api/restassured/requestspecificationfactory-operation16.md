---
id: operation16-call-trigger
title: Calls `operation16` on `RequestSpecificationFactory` for a simple API-side invocation point.
tags:
  - api
  - restassured
  - request-specification
  - factory
  - smoke
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation16
sourceHash: 603ba0e868c5817bf76594e4bd9c7340b1bee4770e37c8576fa1b2b13cf19801
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RequestSpecificationFactory` hook directly instead of adding a new helper.
Requires: A constructed `RequestSpecificationFactory` instance in scope.
API: public void operation16()

```java
requestSpecificationFactory.operation16();
```
