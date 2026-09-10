---
id: operation5-console-call
title: Call `operation5` to emit its standard call trace from `RestAssuredManager`.
tags:
  - restassured
  - api
  - manager
  - logging
  - console
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation5
sourceHash: e299dc7a705e864acf46251cd0f90dd09bb6c966a4302e4918b144ce7338afe4
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestAssuredManager` operation directly instead of adding a new helper.
Requires: An instantiated `RestAssuredManager` object.
API: public void operation5()

```java
restAssuredManager.operation5();
```
