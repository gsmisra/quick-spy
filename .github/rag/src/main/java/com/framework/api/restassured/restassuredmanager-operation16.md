---
id: operation16-console-call
title: Invoke RestAssuredManager operation16 to trigger its built-in API-side runtime signal.
tags:
  - restassured
  - api
  - manager
  - utility
  - invocation
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation16
sourceHash: a8647868fb42412a3981c9b83a393459c716a6571f54aa6bb693d7066d1a74b9
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the predefined `RestAssuredManager` hook named `operation16` instead of adding a new helper method.
Requires: An instantiated `RestAssuredManager` object in scope before invocation.
API: public void operation16()

```java
restAssuredManager.operation16();
```
