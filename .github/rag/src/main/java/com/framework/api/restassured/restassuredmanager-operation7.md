---
id: restassuredmanager-operation7-invoke
title: Invoke `operation7` on `RestAssuredManager` when a test needs this predefined API-manager action.
tags:
  - api
  - restassured
  - manager
  - operation7
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation7
sourceHash: 7ff2dd0dd9815b4fae966542110a5b625f1ba2d35643aca3185d4ea87e0f0953
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when test code should execute the existing `RestAssuredManager` operation7 action instead of adding a new helper.
Requires: An available `RestAssuredManager` instance.
API: public void operation7()

```java
restAssuredManager.operation7();
```
