---
id: operation3-restassured-manager-call
title: Call `operation3` on `RestAssuredManager` to trigger its built-in operation hook.
tags:
  - restassured
  - api
  - manager
  - operation3
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation3
sourceHash: b276fb95b0f24f8317fb60982d55045f0a9e68c139ae9d88174fb4a585fa3574
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestAssuredManager` operation directly instead of adding a new helper.
Requires: An initialized `RestAssuredManager` instance in scope.
API: public void operation3()

```java
restAssuredManager.operation3();
```
