---
id: request-specification-factory-operation1-log-call
title: Invoke RequestSpecificationFactory.operation1 to trigger its basic API-side operation hook.
tags:
  - api
  - restassured
  - request-specification
  - factory
  - logging
  - utility
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#operation1
sourceHash: 168f77699ed7ba06b73ff311294c16d379935625d61b2e3683a2faaf4277b5e0
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the built-in `operation1` behavior on `RequestSpecificationFactory` instead of creating a custom helper path.
Requires: A constructed `RequestSpecificationFactory` instance in scope before invocation.
API: public void operation1()

```java
requestSpecificationFactory.operation1();
```
