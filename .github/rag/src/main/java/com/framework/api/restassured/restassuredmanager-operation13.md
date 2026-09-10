---
id: operation13-restassured-manager-call
title: Invoke the `operation13` method on `RestAssuredManager`.
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
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation13
sourceHash: c1e71d9c01567dc00fe59f3bdde6ccef3d42d7a6391462348ff190f433a67cb1
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to call the existing `operation13` capability on the API manager instead of adding a new helper.
Requires: A `RestAssuredManager` instance is already available in the test context.
API: public void operation13()

```java
restAssuredManager.operation13();
```
