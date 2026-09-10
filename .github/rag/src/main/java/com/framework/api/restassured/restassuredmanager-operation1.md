---
id: operation1-restassured-manager-call
title: Invokes the `operation1` method on `RestAssuredManager`.
tags:
  - restassured
  - api
  - manager
  - method-call
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation1
sourceHash: e8e5991d22306b750b5f16843e43ee03460fbf1ebe6b3739a5cf885f2af03166
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger `RestAssuredManager.operation1()` directly instead of adding a new helper.
Requires: An initialized `RestAssuredManager` instance is available to call.
API: public void operation1()

```java
restAssuredManager.operation1();
```
