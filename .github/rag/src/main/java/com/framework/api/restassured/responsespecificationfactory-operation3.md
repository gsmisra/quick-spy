---
id: response-specification-factory-operation3
title: Call the `operation3` method on `ResponseSpecificationFactory` to trigger its predefined operation hook.
tags:
  - api
  - restassured
  - response
  - factory
  - operation3
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#operation3
sourceHash: ff778bf51743cc13510661812472ac213ad1193ef317d4682c27d9858d8433e6
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `operation3` behavior directly instead of adding a new helper.
Requires: A constructed `ResponseSpecificationFactory` instance.
API: public void operation3()

```java
new ResponseSpecificationFactory().operation3();
```
