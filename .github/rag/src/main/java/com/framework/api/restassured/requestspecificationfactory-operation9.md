---
id: request-specification-factory-operation9-invoke
title: Invoke a no-argument RequestSpecificationFactory method for a basic API-side utility action.
tags:
  - api
  - restassured
  - request-specification
  - factory
  - utility
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation9
sourceHash: fa5a8607471d36d1aaa545c26309451fd7659b4e799c3c951bd3efcc9b6a9c61
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when test code needs to trigger `operation9` on an existing `RequestSpecificationFactory` instance instead of adding custom helper code.
Requires: A constructed and accessible `RequestSpecificationFactory` object in scope.
API: public void operation9()

```java
requestSpecificationFactory.operation9();
```
