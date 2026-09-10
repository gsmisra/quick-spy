---
id: operation4-runtime-message
title: Call `operation4` on `ResponseSpecificationFactory` to trigger its built-in runtime output behavior.
tags:
  - api
  - restassured
  - response
  - factory
  - logging
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#operation4
sourceHash: e719242b20d1e81029937b6766b8acfb1ef509ac6bc8ede2204983de1866c78f
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `ResponseSpecificationFactory` operation directly instead of creating a new helper path.
Requires: An initialized `ResponseSpecificationFactory` instance in scope.
API: public void operation4()

```java
responseSpecificationFactory.operation4();
```
