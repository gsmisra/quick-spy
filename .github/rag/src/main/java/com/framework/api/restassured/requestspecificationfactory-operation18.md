---
id: operation18-request-spec-factory-call
title: Call operation18 on RequestSpecificationFactory to trigger its built-in runtime side effect.
tags:
  - api
  - restassured
  - request-specification
  - factory
  - utility
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation18
sourceHash: 4ee272c3ebd80782b4f9e731b4234a60287b71466733b13d42737918ebffb0b1
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RequestSpecificationFactory` hook directly instead of adding a new helper path.
Requires: A constructed `RequestSpecificationFactory` instance must already be available to call this instance method.
API: public void operation18()

```java
requestSpecificationFactory.operation18();
```
