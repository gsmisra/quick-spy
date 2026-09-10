---
id: operation11-invocation-hook
title: Invoke `operation11` on `ResponseSpecificationFactory` when a test needs this predefined API utility call.
tags:
  - api
  - restassured
  - response-specification
  - factory
  - method-call
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#operation11
sourceHash: fc8a4652e593862d778ed7c3471d0e4c5854a898446734d04014a19c7585d768
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when generated API tests should call the existing `ResponseSpecificationFactory` capability instead of adding a new helper.
Requires: A `ResponseSpecificationFactory` instance is available.
API: public void operation11()

```java
new ResponseSpecificationFactory().operation11();
```
