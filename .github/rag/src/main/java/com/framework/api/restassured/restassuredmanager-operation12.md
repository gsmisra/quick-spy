---
id: operation12-operation-marker
title: Invoke `operation12` to trigger the manager's operation-level execution marker.
tags:
  - restassured
  - api
  - manager
  - method-call
  - logging
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation12
sourceHash: b3392ebcc40986f1d366479d428b68d018a87e87b96f6167d642ac4eefc7cbeb
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute `RestAssuredManager` capability `operation12` directly instead of adding a custom wrapper.
Requires: A `RestAssuredManager` instance already created and available in scope.
API: public void operation12()

```java
restAssuredManager.operation12();
```
