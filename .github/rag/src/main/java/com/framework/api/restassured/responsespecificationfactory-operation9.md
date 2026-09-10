---
id: operation9-basic-invocation
title: Call `operation9` on `ResponseSpecificationFactory` as a no-argument API method.
tags:
  - operation9
  - response-specification
  - restassured
  - api
  - java
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.ResponseSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/ResponseSpecificationFactory.java#operation9
sourceHash: dcc11549903c3c0d1f784250968efff277e1be78a994166454ef049ed1f98cea
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `ResponseSpecificationFactory` capability directly instead of adding a new helper.
Requires: A constructible `ResponseSpecificationFactory` instance in scope; no arguments or additional setup are shown by the excerpt.
API: public void operation9()

```java
new ResponseSpecificationFactory().operation9();
```
