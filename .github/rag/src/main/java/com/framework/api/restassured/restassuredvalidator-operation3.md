---
id: restassured-validator-operation3-invoke
title: Invoke the `operation3` API helper on `RestAssuredValidator`.
tags:
  - restassured
  - api
  - validator
  - method-call
  - smoke
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredValidator
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredValidator.java#operation3
sourceHash: 55a274ca2d2a9e55dda8018357470569de41cceeae24b5546ca1df4a0b771181
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger the predefined `operation3` validator action instead of creating a new helper method.
Requires: An instantiated `RestAssuredValidator` object in scope.
API: public void operation3()

```java
new RestAssuredValidator().operation3();
```
