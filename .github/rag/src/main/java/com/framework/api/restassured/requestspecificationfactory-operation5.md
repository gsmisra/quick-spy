---
id: operation5-request-specification-factory
title: Invoke the `operation5` API helper method on `RequestSpecificationFactory`.
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
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation5
sourceHash: b72a1928cb5122b2668431e4d5dd9af6e5dfbd23ccdf9a73f32e8f4e6308c97e
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger the existing `operation5` behavior instead of adding a new helper method.
Requires: An instantiated `RequestSpecificationFactory` object.
API: public void operation5()

```java
requestSpecificationFactory.operation5();
```
