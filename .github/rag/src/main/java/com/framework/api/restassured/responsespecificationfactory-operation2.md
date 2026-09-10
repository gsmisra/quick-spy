---
id: response-specification-factory-operation2-invocation
title: Call `operation2` on `ResponseSpecificationFactory` for a basic API utility invocation.
tags:
  - api
  - restassured
  - response
  - factory
  - method
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#operation2
sourceHash: bb1f266d2d4717cfadbd039a9f9c58b9f035d60e92b252df3ef5caf01a804864
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `ResponseSpecificationFactory` capability directly instead of creating a new helper path.
Requires: An initialized `ResponseSpecificationFactory` instance in scope.
API: public void operation2()

```java
responseSpecificationFactory.operation2();
```
