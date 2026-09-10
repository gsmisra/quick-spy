---
id: operation15-invoke-request-specification-factory
title: Invoke operation15 on RequestSpecificationFactory for a simple API-side call hook.
tags:
  - api
  - restassured
  - request
  - factory
  - method-call
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation15
sourceHash: 2b3bbdf1e21246790ac133f2e904126938b2fb0e834339595088f1243dfbcb52
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code needs to call the existing `operation15` capability on `RequestSpecificationFactory` rather than adding a new helper.
Requires: An initialized `RequestSpecificationFactory` instance in scope.
API: public void operation15()

```java
requestSpecificationFactory.operation15();
```
