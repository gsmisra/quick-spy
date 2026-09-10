---
id: restassuredmanager-execute-trigger
title: Invoke the RestAssuredManager execute method to run its basic execution step.
tags:
  - restassured
  - api
  - execute
  - manager
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#execute
sourceHash: f8d71e472a59db36ca49041a6aae8d367a65f97f7c60b6788b85ceec06c0acbc
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger the manager’s built-in execute action instead of creating a separate helper.
Requires: A `RestAssuredManager` instance is available to call.
API: public void execute()

```java
new RestAssuredManager().execute();
```
