---
id: operation3-request-specification-factory-call
title: Calls the `operation3` method on `RequestSpecificationFactory` for API test flow integration.
tags:
  - api
  - restassured
  - request-specification
  - factory
  - method-call
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation3
sourceHash: 2bd4ac9428cbbfa2c0e9f974557417cb21c418f4521ce253da5856ab7455d68c
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code needs to invoke the existing `RequestSpecificationFactory` capability directly instead of adding a new helper for the same call site.
Requires: A `RequestSpecificationFactory` instance is already available in scope before calling this method.
API: public void operation3()

```java
requestSpecificationFactory.operation3();
```
