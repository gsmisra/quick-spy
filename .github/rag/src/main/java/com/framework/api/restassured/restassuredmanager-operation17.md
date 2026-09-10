---
id: operation17-no-arg-manager-call
title: Call `operation17` on `RestAssuredManager` to trigger this no-argument API-manager action.
tags:
  - api
  - restassured
  - manager
  - void
  - noargs
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RestAssuredManager
sourcePath: src/main/java/com/framework/api/restassured/RestAssuredManager.java#operation17
sourceHash: 67045968d264b452ff2f72a698e35366aa975d20daff6d51c23bbe6fbc563fe4
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the built-in `RestAssuredManager` no-arg operation directly instead of adding a new helper.
Requires: An instantiated `RestAssuredManager` object in the calling scope.
API: public void operation17()

```java
new RestAssuredManager().operation17();
```
