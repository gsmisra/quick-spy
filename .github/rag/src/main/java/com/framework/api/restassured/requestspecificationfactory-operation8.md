---
id: operation8-request-specification-factory-call
title: Invoke `operation8` on `RequestSpecificationFactory` for a lightweight API-side action hook.
tags:
  - api
  - restassured
  - request-specification
  - factory
  - method-call
  - tracing
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation8
sourceHash: 9ba57bf68aa14ebcc4ca723939b2e554d35272ec05fbe6ab9a1e5342adcb2a03
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to explicitly trigger `RequestSpecificationFactory.operation8()` instead of adding a new helper path.
Requires: An initialized `RequestSpecificationFactory` instance in scope.
API: public void operation8()

```java
requestSpecificationFactory.operation8();
```
