---
id: operation11-restassured-manager-call
title: Call `operation11` on `RestAssuredManager` when a test needs this predefined API-manager action.
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
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation11
sourceHash: 7de229d2ec9ff2957d66406a1ff041507421a83c5dbb841c41c3a4f6df0ef14a
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this method when test code should invoke the existing `RestAssuredManager` capability directly instead of creating a new helper.
Requires: An available `RestAssuredManager` instance.
API: public void operation11()

```java
new RestAssuredManager().operation11();
```
