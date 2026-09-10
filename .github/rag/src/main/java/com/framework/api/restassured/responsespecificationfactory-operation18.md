---
id: response-specification-factory-operation18-status-call
title: Call `operation18` to trigger a simple API-layer status action on `ResponseSpecificationFactory`.
tags:
  - api
  - restassured
  - response-specification
  - factory
  - utility
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#operation18
sourceHash: d8ec4855d5fd4b2f888404f00a80fe86582ecab9f452fed9a721e3df6b8687a8
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a generated API test needs to invoke the existing `ResponseSpecificationFactory` capability directly instead of creating a new helper path.
Requires: An initialized `ResponseSpecificationFactory` instance in scope.
API: public void operation18()

```java
responseSpecificationFactory.operation18();
```
