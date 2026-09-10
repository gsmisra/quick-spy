---
id: restassuredmanager-operation2-call
title: Invoke the `operation2` method on `RestAssuredManager` in API test flows.
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
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation2
sourceHash: ad99f56ab0320fda6aed97c38af8bc170cc5bf233aa03e46d710c58641d3f466
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code needs to invoke the existing `operation2` capability on `RestAssuredManager` instead of creating a duplicate helper.
Requires: A constructed `RestAssuredManager` instance.
API: public void operation2()

```java
new RestAssuredManager().operation2();
```
