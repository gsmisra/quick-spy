---
id: restassured-validator-execute
title: Run the default execution step on a RestAssuredValidator instance.
tags:
  - api
  - restassured
  - validator
  - execute
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredValidator
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredValidator.java#execute
sourceHash: d99802f2c5712aa6df8df679bb794ce5c02c385e1c453b0679b882a6544a5e44
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger the validator’s built-in execution hook rather than adding custom execution code.
Requires: A constructed `RestAssuredValidator` instance is available in scope.
API: public void execute()

```java
new RestAssuredValidator().execute();
```
