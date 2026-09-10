---
id: response-specification-factory-operation7
title: Invoke `operation7` on `ResponseSpecificationFactory` to run its built-in operation step.
tags:
  - api
  - restassured
  - response
  - factory
  - operation
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#operation7
sourceHash: ad9c37b9c835a9013ebda3dc18375bcf591c2d017a0c3d5141abdc98be5f1d76
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the existing `operation7` behavior from `ResponseSpecificationFactory` instead of adding a new helper.
Requires: An instantiated `ResponseSpecificationFactory` object.
API: public void operation7()

```java
responseSpecificationFactory.operation7();
```
