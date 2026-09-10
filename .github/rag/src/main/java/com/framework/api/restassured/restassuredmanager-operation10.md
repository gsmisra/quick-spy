---
id: operation10-restassured-invocation
title: Call RestAssuredManager.operation10 to execute this API utility step.
tags:
  - api
  - restassured
  - manager
  - method-call
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation10
sourceHash: 3c5e470bc76e715b3ad2f2de8c4b9077e8bdfd7e29ae66ad03e45291021e4f1d
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code needs to invoke the existing `operation10` method on `RestAssuredManager` rather than creating a new helper.
Requires: A `RestAssuredManager` instance available in the test context.
API: public void operation10()

```java
new RestAssuredManager().operation10();
```
