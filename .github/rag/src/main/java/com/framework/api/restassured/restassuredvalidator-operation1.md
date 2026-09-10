---
id: restassured-validator-operation1-log-call
title: Calls `operation1` on `RestAssuredValidator` to trigger its operation-level console output.
tags:
  - restassured
  - validator
  - api
  - logging
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredValidator
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredValidator.java#operation1
sourceHash: 0149e52358c6efd4b0a21e994662e6d02f9d862a8210625f7e7e5ba1d633ee44
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the validator's basic operation1 hook instead of adding a custom helper.
Requires: An initialized `RestAssuredValidator` instance.
API: public void operation1()

```java
new RestAssuredValidator().operation1();
```
