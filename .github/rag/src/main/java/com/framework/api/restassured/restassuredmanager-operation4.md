---
id: operation4-restassured-call-log
title: Calls `operation4` on `RestAssuredManager` to trigger the predefined API-side operation hook.
tags:
  - restassured
  - api
  - manager
  - operation4
  - logging
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation4
sourceHash: 6a1d990144ffcfd8f83c0bc7058d639f7ecd8125b346644c58544261228e2965
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestAssuredManager` operation entrypoint directly instead of creating a new helper path.

Requires: A usable `RestAssuredManager` instance in scope before invocation.

API: public void operation4()

```java
restAssuredManager.operation4();
```
