---
id: response-specification-factory-execute
title: Run the `execute` method on `ResponseSpecificationFactory` to trigger its built-in execution step.
tags:
  - response
  - specification
  - factory
  - restassured
  - execute
  - api
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#execute
sourceHash: 27559160a092ce3a5f66269cbe9767101f306ebbb1d4985e7a1407c6d58f1ed6
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to invoke the `ResponseSpecificationFactory` execution step directly instead of duplicating that call path.
Requires: An initialized `ResponseSpecificationFactory` instance in scope.
API: public void execute()

```java
responseSpecificationFactory.execute();
```
