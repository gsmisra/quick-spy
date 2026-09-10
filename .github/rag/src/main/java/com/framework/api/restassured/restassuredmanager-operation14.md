---
id: operation14-restassured-manager-call
title: Invoke RestAssuredManager operation14 for a basic API-side manager call.
tags:
  - api
  - restassured
  - manager
  - utility
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation14
sourceHash: 5beae577d68a3ea6ab87c5649fb29d13ef9a9b7b8a6373e9785f37f4a873de62
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger the existing `operation14` manager hook instead of adding a new helper path.
Requires: A `RestAssuredManager` instance is already created and available to the caller.
API: public void operation14()

```java
restAssuredManager.operation14();
```
