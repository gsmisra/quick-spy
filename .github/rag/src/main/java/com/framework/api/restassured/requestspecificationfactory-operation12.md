---
id: operation12-invocation-log
title: Triggers the operation12 step on RequestSpecificationFactory for API test flows.
tags:
  - restassured
  - api
  - request-specification
  - factory
  - hook
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation12
sourceHash: 3b8e686adcb97095b1a65cda9a3c7efa573bdde96514ab883a0e3e5afaa91f62
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when test code needs to execute the existing `operation12` capability on a `RequestSpecificationFactory` instance instead of creating a new helper path.
Requires: An initialized `RequestSpecificationFactory` object must already be available in scope.
API: public void operation12()

```java
requestSpecificationFactory.operation12();
```
