---
id: request-specification-factory-operation2-invoke
title: Invoke the operation2 method on RequestSpecificationFactory as part of API utility execution.
tags:
  - api
  - restassured
  - request-specification
  - factory
  - method-call
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation2
sourceHash: 652ef15cc989369e75178443657c2bedd039379316a5f8fceae11c0b1375d8a2
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when test code needs to execute the existing `operation2` capability on a `RequestSpecificationFactory` instance instead of creating a duplicate helper.
Requires: An initialized `RequestSpecificationFactory` object in scope.
API: public void operation2()

```java
requestSpecificationFactory.operation2();
```
