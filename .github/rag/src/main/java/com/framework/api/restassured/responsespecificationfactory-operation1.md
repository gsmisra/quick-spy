---
id: response-specification-factory-operation1-call
title: Call `operation1` on `ResponseSpecificationFactory` to trigger its built-in operation entry point.
tags:
  - api
  - restassured
  - response
  - factory
  - operation1
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#operation1
sourceHash: 19654d5504525355a90dff63882f474e548521bc2282d7958de21e171b616988
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when generated API test code needs to invoke the existing `ResponseSpecificationFactory` operation directly instead of creating a new helper.
Requires: A constructed `ResponseSpecificationFactory` instance in scope.
API: public void operation1()

```java
responseSpecificationFactory.operation1();
```
