---
id: operation8-log-invocation
title: Calls `operation8` on `RestAssuredManager` to trigger its basic API-side invocation hook.
tags:
  - api
  - restassured
  - manager
  - operation8
  - logging
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation8
sourceHash: 82175d51168b4e294b144d45fbb35668847814d2f1f4078a0ad4fd7a905938d7
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the predefined `RestAssuredManager` operation directly instead of adding a new helper call path.
Requires: A ready `RestAssuredManager` instance in scope before invocation.
API: public void operation8()

```java
restAssuredManager.operation8();
```
