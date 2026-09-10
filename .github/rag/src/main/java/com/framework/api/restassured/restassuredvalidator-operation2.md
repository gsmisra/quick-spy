---
id: operation2-restassured-validator-call
title: Invoke the no-argument `operation2` method on `RestAssuredValidator` for API-flow utility execution.
tags:
  - api
  - restassured
  - validator
  - method-call
  - java
  - no-args
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredValidator
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredValidator.java#operation2
sourceHash: ddf955a4e209beb928921ce5a661477580f89f5e7ea7438dd342144e19a26d7f
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code needs to trigger the existing `RestAssuredValidator` no-arg operation directly instead of creating a duplicate helper path.

Requires: A constructed `RestAssuredValidator` instance in scope before invocation.

API: public void operation2()

```java
new RestAssuredValidator().operation2();
```
